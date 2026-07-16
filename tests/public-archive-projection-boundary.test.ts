import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const canonicalPublicArchiveId = "kinresolve-demo-public";

describe("public archive route projections", () => {
  it("binds every database-backed public route to the explicit canonical archive", async () => {
    const [home, people, person, places, config] = await Promise.all([
      source("app/page.tsx"),
      source("app/people/page.tsx"),
      source("app/people/[slug]/page.tsx"),
      source("app/places/page.tsx"),
      source("lib/public-demo-config.ts")
    ]);

    expect(config).toContain(`publicDemoCanonicalArchiveId = "${canonicalPublicArchiveId}"`);

    for (const [path, route] of [
      ["app/page.tsx", home],
      ["app/people/page.tsx", people],
      ["app/people/[slug]/page.tsx", person],
      ["app/places/page.tsx", places]
    ] as const) {
      expect(route, path).toContain("publicDemoCanonicalArchiveId");
      expect(route, path).toMatch(/archiveId:\s*publicDemoCanonicalArchiveId/);
      expect(route, path).not.toMatch(/readWorkspace\s*\(\s*\)/);
    }
  });

  it("uses a dedicated SQL place projection instead of materializing a workspace", async () => {
    const [places, queries] = await Promise.all([
      source("app/places/page.tsx"),
      source("lib/store/people-queries.ts")
    ]);

    expect(places).toMatch(/listPublicPlaces\s*\(\s*\{\s*archiveId:\s*publicDemoCanonicalArchiveId\s*\}\s*\)/s);
    expect(places).not.toMatch(/readWorkspace|canPublishPerson|publicFactFilter/);

    const projection = exportedFunction(queries, "listPublicPlaces");
    expect(projection).toMatch(/options:\s*WorkspaceStoreOptions/);
    expect(projection).not.toMatch(/options:\s*WorkspaceStoreOptions\s*=\s*\{\}/);
    expect(projection).not.toMatch(/getArchiveId|readWorkspace|SELECT\s+\*/i);
    expect(projection).not.toMatch(/\bnotes\b/i);
    expect(projection).toMatch(/pf\.privacy\s*=\s*'public'/i);
    expect(projection).toMatch(/p\.published/i);
    expect(projection).toMatch(/p\.privacy\s*=\s*'public'/i);
    expect(projection).toMatch(/p\.living_status\s*=\s*'deceased'/i);
  });

  it("keeps the public stories route fixture-only", async () => {
    const stories = await source("app/stories/page.tsx");

    expect(stories).toMatch(/const stories = \[/);
    expect(stories).not.toMatch(/readWorkspace|listPublicPeople|query\s*\(|@\/lib\/db/);
    expect(stories).not.toMatch(/\b(?:notes|rawRecords|dnaMatches|aiRuns|imports|backups)\b/);
  });
});

describe("public person SQL projection source", () => {
  it.each(["listPublicPeople", "getPublicPersonBySlug"] as const)(
    "%s requires explicit archive scope and never selects private columns",
    async (functionName) => {
      const queries = await source("lib/store/people-queries.ts");
      const projection = exportedFunction(queries, functionName);

      expect(projection).toMatch(/options:\s*WorkspaceStoreOptions/);
      expect(projection).not.toMatch(/options:\s*WorkspaceStoreOptions\s*=\s*\{\}/);
      expect(projection).not.toMatch(/getArchiveId|SELECT\s+\*/i);
      expect(projection).not.toMatch(/\bnotes\b/i);
      expect(projection).toMatch(/p\.published/i);
      expect(projection).toMatch(/p\.privacy\s*=\s*'public'/i);
      expect(projection).toMatch(/p\.living_status\s*=\s*'deceased'/i);
      expect(projection).toMatch(/pf\.privacy\s*=\s*'public'/i);
    }
  );
});

async function source(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function exportedFunction(moduleSource: string, functionName: string): string {
  const start = moduleSource.indexOf(`export async function ${functionName}`);
  if (start < 0) return "";
  const nextExport = moduleSource.indexOf("\nexport async function ", start + 1);
  return moduleSource.slice(start, nextExport < 0 ? undefined : nextExport);
}
