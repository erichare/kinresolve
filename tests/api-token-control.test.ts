import { describe, expect, it } from "vitest";

import { apiTokenCreationAllowed } from "@/components/api-token-control";

describe("API token one-time secret control", () => {
  it("requires the current secret to be acknowledged before another token can be created", () => {
    const valid = {
      confirmArchiveExport: false,
      includesExport: false,
      name: "Developer quickstart",
      scopeCount: 1
    };

    expect(apiTokenCreationAllowed({ ...valid, oneTimeTokenPresent: false })).toBe(true);
    expect(apiTokenCreationAllowed({ ...valid, oneTimeTokenPresent: true })).toBe(false);
  });
});
