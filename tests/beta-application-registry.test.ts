import { describe, expect, it } from "vitest";

import {
  allowedApiMethods,
  isApiWriteBlockedByReleaseFence,
  resolveApiAccess,
  resolveApiMethodPolicy,
  resolveApiRoute
} from "@/lib/api-access";

describe("beta application API registry", () => {
  it("registers one exact public POST with a dedicated narrow request policy", () => {
    const route = resolveApiRoute("/api/public/beta-applications");
    expect(route?.path).toBe("/api/public/beta-applications");
    expect(allowedApiMethods(route!)).toEqual(["POST"]);
    expect(resolveApiAccess(route!.path, "POST")).toEqual({ kind: "public" });
    expect(resolveApiMethodPolicy(route!.path, "POST")).toBe("marketing-native-form");
    expect(resolveApiMethodPolicy(route!.path, "OPTIONS")).toBeNull();
    expect(isApiWriteBlockedByReleaseFence(route!.path, "POST")).toBe(true);
  });
});
