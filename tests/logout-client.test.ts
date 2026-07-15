import { describe, expect, it, vi } from "vitest";

import { requestSameOriginLogout } from "@/lib/logout-client";

describe("same-origin logout client", () => {
  it("uses a browser same-origin fetch and accepts only the exact login redirect", async () => {
    const fetchLogout = vi.fn(async () => ({
      status: 204,
      type: "basic" as const,
      url: "https://app.kinresolve.com/api/auth/logout"
    }));

    await expect(requestSameOriginLogout(fetchLogout)).resolves.toBeUndefined();
    expect(fetchLogout).toHaveBeenCalledWith("/api/auth/logout", {
      body: "",
      credentials: "same-origin",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      method: "POST",
      redirect: "error"
    });
  });

  it.each([
    ["a rejected mutation", { status: 403, type: "basic", url: "https://app.kinresolve.com/api/auth/logout" }],
    ["an ordinary success response", { status: 200, type: "basic", url: "https://app.kinresolve.com/api/auth/logout" }],
    ["an opaque response", { status: 0, type: "opaqueredirect", url: "https://app.kinresolve.com/api/auth/logout" }],
    ["a different endpoint", { status: 204, type: "basic", url: "https://app.kinresolve.com/api/auth/session" }]
  ] as const)("fails closed for %s", async (_label, response) => {
    await expect(requestSameOriginLogout(
      vi.fn(async () => response)
    )).rejects.toThrow("Logout request was not accepted");
  });
});
