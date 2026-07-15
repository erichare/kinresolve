import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReleaseFenceControlHandler,
  releaseFenceLockedResponse
} from "@/lib/release-fence-http";
import { ReleaseFenceError, type ReleaseFenceTransitionResult } from "@/lib/release-fence";

const releaseCommitSha = "a".repeat(40);
const fenceId = "fence-private-beta-01";
const releaseFenceSecret = "a".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("release fence HTTP control", () => {
  it("authenticates with dedicated RELEASE_FENCE_SECRET before reading or acting on a request", async () => {
    const operation = vi.fn();
    const handler = createReleaseFenceControlHandler("acquire", operation);

    expect((await handler(request(undefined, "not-json", "text/plain"))).status).toBe(503);
    vi.stubEnv("RELEASE_FENCE_SECRET", "weak-secret");
    expect((await handler(request("weak-secret", "not-json", "text/plain"))).status).toBe(503);
    vi.stubEnv("RELEASE_FENCE_SECRET", releaseFenceSecret);
    expect((await handler(request("wrong-secret", "not-json", "text/plain"))).status).toBe(401);
    expect(operation).not.toHaveBeenCalled();
  });

  it.each([
    ["missing JSON content type", JSON.stringify({ fenceId, releaseCommitSha }), undefined],
    ["invalid JSON", "not-json", "application/json"],
    ["array JSON", "[]", "application/json"],
    ["missing SHA", JSON.stringify({ fenceId }), "application/json"],
    ["extra key", JSON.stringify({ fenceId, releaseCommitSha, force: true }), "application/json"],
    ["unsafe fence id", JSON.stringify({ fenceId: "../fence", releaseCommitSha }), "application/json"],
    ["short SHA", JSON.stringify({ fenceId, releaseCommitSha: "abc123" }), "application/json"]
  ])("rejects %s with a strict input contract", async (_label, body, contentType) => {
    vi.stubEnv("RELEASE_FENCE_SECRET", releaseFenceSecret);
    const operation = vi.fn();
    const handler = createReleaseFenceControlHandler("assert", operation);

    const response = await handler(request(releaseFenceSecret, body, contentType));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "The release fence request is invalid" });
    expect(operation).not.toHaveBeenCalled();
  });

  it.each([
    ["acquire", 201, "acquired"],
    ["assert", 200, "asserted"],
    ["reacquire", 200, "reacquired"],
    ["release", 200, "released"]
  ] as const)("returns strict metadata for an authenticated %s transition", async (action, status, transition) => {
    vi.stubEnv("RELEASE_FENCE_SECRET", releaseFenceSecret);
    const result = transitionResult(transition);
    const operation = vi.fn().mockResolvedValue(result);
    const handler = createReleaseFenceControlHandler(action, operation);

    const response = await handler(request(
      releaseFenceSecret,
      JSON.stringify({ fenceId, releaseCommitSha }),
      "application/json; charset=utf-8"
    ));

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      fenceId,
      releaseCommitSha,
      active: transition !== "released",
      released: transition === "released",
      activatedAt: "2026-07-15T06:00:00.000Z",
      activationGeneration: transition === "reacquired" ? 2 : 1,
      transition
    });
    expect(operation).toHaveBeenCalledExactlyOnceWith({ fenceId, releaseCommitSha });
  });

  it.each(["acquire", "reacquire", "release"] as const)(
    "disables authenticated %s transitions in hosted runtimes",
    async (action) => {
      vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
      vi.stubEnv("RELEASE_FENCE_SECRET", releaseFenceSecret);
      const operation = vi.fn();
      const handler = createReleaseFenceControlHandler(action, operation);

      const response = await handler(request(
        releaseFenceSecret,
        JSON.stringify({ fenceId, releaseCommitSha }),
        "application/json"
      ));

      expect(response.status).toBe(405);
      await expect(response.json()).resolves.toEqual({
        error: "Release fence transitions are disabled in the hosted runtime"
      });
      expect(operation).not.toHaveBeenCalled();
    }
  );

  it("keeps authenticated assert read-only behavior available in hosted runtimes", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("RELEASE_FENCE_SECRET", releaseFenceSecret);
    const operation = vi.fn().mockResolvedValue(transitionResult("asserted"));
    const handler = createReleaseFenceControlHandler("assert", operation);

    const response = await handler(request(
      releaseFenceSecret,
      JSON.stringify({ fenceId, releaseCommitSha }),
      "application/json"
    ));

    expect(response.status).toBe(200);
    expect(operation).toHaveBeenCalledExactlyOnceWith({ fenceId, releaseCommitSha });
  });

  it("maps missing and conflicting transitions without leaking database details", async () => {
    vi.stubEnv("RELEASE_FENCE_SECRET", releaseFenceSecret);
    for (const [code, status] of [["NOT_FOUND", 404], ["CONFLICT", 409]] as const) {
      const operation = vi.fn().mockRejectedValue(new ReleaseFenceError(code, "private database detail"));
      const handler = createReleaseFenceControlHandler("release", operation);
      const response = await handler(request(
        releaseFenceSecret,
        JSON.stringify({ fenceId, releaseCommitSha }),
        "application/json"
      ));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: code === "NOT_FOUND" ? "Release fence not found" : "Release fence transition conflict"
      });
    }
  });

  it("keeps the anonymous 423 response generic while preserving authenticated evidence", async () => {
    const fence = {
      fenceId,
      releaseCommitSha,
      state: "active",
      activationGeneration: 1,
      firstActivatedAt: "2026-07-15T06:00:00.000Z",
      activatedAt: "2026-07-15T06:00:00.000Z",
      releasedAt: null,
      updatedAt: "2026-07-15T06:00:00.000Z"
    } as const;
    const response = releaseFenceLockedResponse(fence);

    expect(response.status).toBe(423);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({
      error: "Writes are temporarily paused for release safety"
    });

    const evidenceResponse = releaseFenceLockedResponse(fence, { discloseControlIdentity: true });
    await expect(evidenceResponse.json()).resolves.toEqual({
      error: "Writes are temporarily paused for release safety",
      fenceId,
      releaseCommitSha
    });
  });
});

function request(secret: string | undefined, body: string, contentType: string | undefined): Request {
  const headers = new Headers();
  if (secret) headers.set("authorization", `Bearer ${secret}`);
  if (contentType) headers.set("content-type", contentType);
  return new Request("https://app.kinresolve.com/api/release/fence/acquire", {
    method: "POST",
    headers,
    body
  });
}

function transitionResult(transition: ReleaseFenceTransitionResult["transition"]): ReleaseFenceTransitionResult {
  return {
    fence: {
      fenceId,
      releaseCommitSha,
      state: transition === "released" ? "released" : "active",
      activationGeneration: transition === "reacquired" ? 2 : 1,
      firstActivatedAt: "2026-07-15T06:00:00.000Z",
      activatedAt: "2026-07-15T06:00:00.000Z",
      releasedAt: transition === "released" ? "2026-07-15T07:00:00.000Z" : null,
      updatedAt: "2026-07-15T07:00:00.000Z"
    },
    transition
  };
}
