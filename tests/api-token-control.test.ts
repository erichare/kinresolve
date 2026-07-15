import { readFile } from "node:fs/promises";
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

  it("keeps scope checkboxes compact instead of inheriting full-width field controls", async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL("../components/api-token-control.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8")
    ]);

    expect(source).toContain('className="field api-token-scopes"');
    expect(source).toContain('className="api-token-scope"');
    expect(source.match(/className="api-token-checkbox"/g)).toHaveLength(2);
    expect(styles).toContain(".field .api-token-checkbox");
    expect(styles).toMatch(/\.field \.api-token-checkbox \{[\s\S]*?width: 18px;[\s\S]*?min-height: 18px;/);
  });
});
