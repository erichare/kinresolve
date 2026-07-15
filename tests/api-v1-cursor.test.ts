import { describe, expect, it } from "vitest";

import {
  ApiV1CursorError,
  decodeApiV1Cursor,
  encodeApiV1Cursor,
  parseApiV1PageRequest
} from "@/lib/api-v1-cursor";

const environment = {
  KINRESOLVE_API_CURSOR_SECRET: "cursor-secret-with-at-least-thirty-two-private-bytes"
};
const resourceId = "11111111-1111-4111-8111-111111111111";

describe("API v1 opaque cursors", () => {
  it("uses a bounded default and round-trips a signed cursor", () => {
    const cursor = encodeApiV1Cursor(
      { sortOrder: -2, id: resourceId },
      "/api/v1/people",
      "archive-a",
      environment
    );
    const parsed = parseApiV1PageRequest(
      new URL(`https://app.kinresolve.com/api/v1/people?cursor=${encodeURIComponent(cursor)}`),
      "/api/v1/people",
      "archive-a",
      environment
    );

    expect(parsed).toEqual({ limit: 25, cursor: { sortOrder: -2, id: resourceId } });
  });

  it("round-trips only the non-content API surrogate", () => {
    const cursor = encodeApiV1Cursor(
      { sortOrder: 7, id: resourceId },
      "/api/v1/people",
      "archive-a",
      environment
    );

    expect(decodeApiV1Cursor(cursor, "/api/v1/people", "archive-a", environment))
      .toEqual({ sortOrder: 7, id: resourceId });
    expect(Buffer.from(cursor.split(".")[0]!, "base64url").toString("utf8"))
      .not.toMatch(/@I1@|José|Müller/);
  });

  it.each(["@I1@", "José /Müller/", "person-1", "11111111-1111-1111-1111-111111111111"])(
    "rejects internal, content-bearing, or invalid API resource id %j",
    (id) => {
      expect(() => encodeApiV1Cursor(
        { sortOrder: 1, id },
        "/api/v1/people",
        "archive-a",
        environment
      )).toThrow(ApiV1CursorError);
    }
  );

  it.each(["0", "01", "101", "1.5", "nope"])("rejects invalid limit %s", (limit) => {
    expect(() => parseApiV1PageRequest(
      new URL(`https://app.kinresolve.com/api/v1/people?limit=${limit}`),
      "/api/v1/people",
      "archive-a",
      environment
    )).toThrow(ApiV1CursorError);
  });

  it("rejects unsupported query parameters", () => {
    expect(() => parseApiV1PageRequest(
      new URL("https://app.kinresolve.com/api/v1/people?query=private-name"),
      "/api/v1/people",
      "archive-a",
      environment
    )).toThrow(/Unsupported query parameter/);
  });

  it.each([
    "limit=10&limit=20",
    "cursor=one&cursor=two",
    "cursor=",
    `cursor=${"a".repeat(2_049)}`
  ])("rejects ambiguous or unbounded query %s", (query) => {
    expect(() => parseApiV1PageRequest(
      new URL(`https://app.kinresolve.com/api/v1/people?${query}`),
      "/api/v1/people",
      "archive-a",
      environment
    )).toThrow(ApiV1CursorError);
  });

  it("binds cursors to the exact route and archive", () => {
    const cursor = encodeApiV1Cursor(
      { sortOrder: 4, id: resourceId },
      "/api/v1/people",
      "archive-a",
      environment
    );

    expect(() => decodeApiV1Cursor(
      cursor,
      "/api/v1/sources",
      "archive-a",
      environment
    )).toThrow(/invalid for this resource/);
    expect(() => decodeApiV1Cursor(
      cursor,
      "/api/v1/people",
      "archive-b",
      environment
    )).toThrow(/invalid for this resource/);
  });

  it("rejects tampering and weak or missing cursor secrets", () => {
    const cursor = encodeApiV1Cursor(
      { sortOrder: 4, id: resourceId },
      "/api/v1/people",
      "archive-a",
      environment
    );
    const [payload, signature] = cursor.split(".");
    expect(() => decodeApiV1Cursor(
      `${payload}x.${signature}`,
      "/api/v1/people",
      "archive-a",
      environment
    )).toThrow(/invalid/);
    expect(() => encodeApiV1Cursor(
      { sortOrder: 1, id: resourceId },
      "/api/v1/people",
      "archive-a",
      {}
    )).toThrow(/KINRESOLVE_API_CURSOR_SECRET/);
  });

  it.each(["$", "=", "%", "\n"])(
    "rejects non-canonical signature suffix %j",
    (suffix) => {
      const cursor = encodeApiV1Cursor(
        { sortOrder: 4, id: resourceId },
        "/api/v1/people",
        "archive-a",
        environment
      );
      expect(() => decodeApiV1Cursor(
        `${cursor}${suffix}`,
        "/api/v1/people",
        "archive-a",
        environment
      )).toThrow(ApiV1CursorError);
    }
  );
});
