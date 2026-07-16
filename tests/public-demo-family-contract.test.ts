import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { demoPeople } from "@/lib/demo-data";
import { createDemoWorkspace } from "@/lib/workspace-store";

describe("curated Hartwell-Mercer public family", () => {
  it("publishes all eight unique deceased fictional profiles and only public facts", () => {
    expect(demoPeople).toHaveLength(8);
    expect(new Set(demoPeople.map((person) => person.id)).size).toBe(8);

    for (const person of demoPeople) {
      expect(person, person.displayName).toMatchObject({
        livingStatus: "deceased",
        privacy: "public",
        published: true
      });
      expect(person.facts.length, `${person.displayName} public facts`).toBeGreaterThan(0);
      expect(person.facts.every((fact) => fact.privacy === "public"), person.displayName).toBe(true);
    }
  });

  it("projects all seven citations without exposing private workspace fields", async () => {
    const workspace = createDemoWorkspace(new Date("2026-07-16T00:00:00.000Z"));
    expect(workspace.sources).toHaveLength(7);

    const projection = await source("lib/public-family.ts");
    expect(projection).toMatch(/export type PublicFamilyProjection/);
    expect(projection).toMatch(/export (?:async )?function readPublicFamilyProjection/);
    expect(projection).toMatch(/people/);
    expect(projection).toMatch(/citations/);
    expect(projection).toMatch(/canPublishPerson/);
    expect(projection).toMatch(/publicFactFilter/);
    expect(projection).not.toMatch(/\b(?:cases|dnaMatches|imports|backups|aiRuns|rawRecords|notes|transcript)\b/);
  });

  it("serves the family landing from the public-only projection", async () => {
    const familyPage = await source("app/family/page.tsx");

    expect(familyPage).toMatch(/readPublicFamilyProjection/);
    expect(familyPage).not.toMatch(/readWorkspace/);
    expect(familyPage).toMatch(/Public family archive/i);
    expect(familyPage).toMatch(/fictional/i);
    expect(familyPage).toMatch(/published profiles/i);
  });
});

async function source(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
