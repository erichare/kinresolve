import { describe, expect, it } from "vitest";
import { assertPermission, getPermissions, hasPermission } from "@/lib/rbac";
import { canPublishPerson, inferLivingStatus, publicFactFilter } from "@/lib/privacy";
import type { PersonSummary } from "@/lib/models";

describe("privacy and RBAC", () => {
  it("uses the conservative 100-year living-person rule", () => {
    expect(inferLivingStatus([{ type: "BIRT", date: "1990" }], 2026)).toBe("living");
    expect(inferLivingStatus([{ type: "BIRT", date: "1880" }], 2026)).toBe("deceased");
    expect(inferLivingStatus([{ type: "DEAT", date: "2020" }], 2026)).toBe("deceased");
  });

  it("blocks public publishing for living or private people", () => {
    const base: PersonSummary = {
      id: "p1",
      slug: "person",
      displayName: "Test Person",
      livingStatus: "living",
      privacy: "public",
      published: false,
      facts: [],
      relatives: []
    };

    expect(canPublishPerson(base)).toBe(false);
    expect(canPublishPerson({ ...base, livingStatus: "deceased" })).toBe(true);
    expect(canPublishPerson({ ...base, livingStatus: "deceased", privacy: "private" })).toBe(false);
  });

  it("fails closed when a fact has no explicit public classification", () => {
    const fact = { id: "f1", type: "BIRT", confidence: 0.9 };

    expect(publicFactFilter(fact)).toBe(false);
    expect(publicFactFilter({ ...fact, privacy: "private" })).toBe(false);
    expect(publicFactFilter({ ...fact, privacy: "public" })).toBe(true);
  });

  it("limits whole-tree AI to owner/admin", () => {
    expect(hasPermission("owner", "ai:whole-tree")).toBe(true);
    expect(hasPermission("admin", "ai:whole-tree")).toBe(true);
    expect(hasPermission("editor", "ai:whole-tree")).toBe(false);
    expect(() => assertPermission("viewer", "ai:whole-tree")).toThrow(/cannot perform/);
    expect(getPermissions("contributor")).toContain("evidence:write");
  });
});
