import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { demoPeople } from "@/lib/demo-data";
import { readPublicFamilyProjection } from "@/lib/public-family";
import { createDemoWorkspace } from "@/lib/workspace-store";

describe("curated Hartwell-Mercer public family", () => {
  it("publishes all 22 unique deceased fictional profiles and only public facts", () => {
    expect(demoPeople).toHaveLength(22);
    expect(new Set(demoPeople.map((person) => person.id)).size).toBe(22);
    expect(new Set(demoPeople.map((person) => person.slug)).size).toBe(22);
    const factIds = demoPeople.flatMap((person) => person.facts.map((fact) => fact.id));
    expect(new Set(factIds).size).toBe(factIds.length);
    const peopleById = new Map(demoPeople.map((person) => [person.id, person]));

    for (const person of demoPeople) {
      expect(person, person.displayName).toMatchObject({
        livingStatus: "deceased",
        privacy: "public",
        published: true
      });
      expect(person.facts.length, `${person.displayName} public facts`).toBeGreaterThan(0);
      expect(person.facts.every((fact) => fact.privacy === "public"), person.displayName).toBe(true);
      for (const relativeId of person.relatives) {
        const relative = peopleById.get(relativeId);
        expect(relative, `${person.displayName} relative ${relativeId}`).toBeDefined();
        expect(relative?.relatives, `${person.displayName} and ${relativeId} are reciprocal`).toContain(person.id);
      }
    }
  });

  it("projects every public person exactly once into a typed, connected five-generation tree", async () => {
    const family = await readPublicFamilyProjection();
    const publicPersonIds = new Set(family.people.map((person) => person.id));
    const treePersonIds = family.tree.generations.flatMap((generation) =>
      generation.members.map((member) => member.personId)
    );

    expect(family.tree.generations).toHaveLength(5);
    expect(family.tree.families).toHaveLength(8);
    expect(treePersonIds).toHaveLength(family.people.length);
    expect(new Set(treePersonIds)).toEqual(publicPersonIds);

    for (const familyUnit of family.tree.families) {
      expect(familyUnit.partnerIds).toHaveLength(2);
      expect(new Set(familyUnit.partnerIds).size).toBe(2);
      expect(familyUnit.childIds.length).toBeGreaterThan(0);
      expect(new Set(familyUnit.childIds).size).toBe(familyUnit.childIds.length);
      for (const personId of [...familyUnit.partnerIds, ...familyUnit.childIds]) {
        expect(publicPersonIds.has(personId), `${familyUnit.id} references ${personId}`).toBe(true);
      }
    }

    expect(
      family.tree.families
        .filter((familyUnit) => familyUnit.childIds.length > 2)
        .map((familyUnit) => [familyUnit.id, familyUnit.childIds.length])
    ).toEqual([
      ["family-elias-amalia", 3],
      ["family-nora-samuel", 4]
    ]);
    expect(family.tree.families.find((familyUnit) => familyUnit.id === "family-clara-henry")?.childIds)
      .toEqual(["p-june-vale"]);
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
    expect(familyPage).toMatch(/PublicFamilyTree/);
    expect(familyPage).toMatch(/complete five-generation tree/i);
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
