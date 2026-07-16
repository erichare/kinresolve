import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("public demo read-only workspace UI", () => {
  it.each([
    {
      pagePath: "app/app/cases/page.tsx",
      componentPath: "components/case-workspace.tsx",
      componentName: "CaseWorkspace",
      mutationContract: /!readOnly\s*\?\s*\([\s\S]*New case[\s\S]*\)\s*:\s*null/
    },
    {
      pagePath: "app/app/sources/page.tsx",
      componentPath: "components/source-workspace.tsx",
      componentName: "SourceWorkspace",
      mutationContract: /!readOnly\s*\?\s*\([\s\S]*Add source[\s\S]*\)\s*:\s*null/
    },
    {
      pagePath: "app/app/dna/page.tsx",
      componentPath: "components/dna-triage-workspace.tsx",
      componentName: "DnaTriageWorkspace",
      mutationContract: /!readOnly\s*\?\s*\([\s\S]*Import DNA matches[\s\S]*Analyze a match[\s\S]*Link to case[\s\S]*Triage selected match[\s\S]*\)\s*:\s*null/
    }
  ])("passes and enforces read-only mode for $componentName", async ({
    pagePath,
    componentPath,
    componentName,
    mutationContract
  }) => {
    const [page, component] = await Promise.all([source(pagePath), source(componentPath)]);

    expect(page).toMatch(new RegExp(
      `<${componentName}\\b[\\s\\S]{0,900}?readOnly=\\{session\\.kind\\s*===\\s*["']demo-guest["']\\}`
    ));
    expect(component).toMatch(/readOnly\??:\s*boolean/);
    expect(component).toMatch(mutationContract);
  });

  it("offers the bundled GEDCOM review, apply, and rollback flow without visitor input", async () => {
    const [dashboard, panel] = await Promise.all([
      source("app/app/page.tsx"),
      source("components/demo-sample-import-panel.tsx")
    ]);

    expect(dashboard).toMatch(/import\s+\{?\s*DemoSampleImportPanel/);
    expect(dashboard).toMatch(/session\.kind\s*===\s*["']demo-guest["'][\s\S]{0,1600}<DemoSampleImportPanel\b/);
    expect(panel).toContain("/api/demo/sample-import");
    expect(panel).toContain("hartwell-mercer-sample-v1");
    expect(panel).toMatch(/action:\s*["']review["']/);
    expect(panel).toMatch(/action:\s*["']apply["']/);
    expect(panel).toMatch(/action:\s*["']rollback["']/);
    expect(panel).not.toMatch(/<textarea\b|contentEditable|type=["']file["']|type=["']text["']/i);
  });
});

describe("public demo search privacy", () => {
  it.each([
    {
      pagePath: "app/app/people/page.tsx",
      componentPath: "components/people-workspace.tsx",
      componentName: "PeopleWorkspace",
      loaderName: "loadPeople"
    },
    {
      pagePath: "app/app/cases/page.tsx",
      componentPath: "components/case-workspace.tsx",
      componentName: "CaseWorkspace",
      loaderName: "loadCases"
    },
    {
      pagePath: "app/app/sources/page.tsx",
      componentPath: "components/source-workspace.tsx",
      componentName: "SourceWorkspace",
      loaderName: "loadSources"
    },
    {
      pagePath: "app/app/dna/page.tsx",
      componentPath: "components/dna-triage-workspace.tsx",
      componentName: "DnaTriageWorkspace",
      loaderName: "loadMatches"
    }
  ])("keeps $componentName queries in the browser for demo guests", async ({
    pagePath,
    componentPath,
    componentName,
    loaderName
  }) => {
    const [page, component] = await Promise.all([source(pagePath), source(componentPath)]);

    expect(page).toMatch(new RegExp(
      `<${componentName}\\b[\\s\\S]{0,900}?clientSideSearch=\\{session\\.kind\\s*===\\s*["']demo-guest["']\\}`
    ));
    expect(component).toMatch(/clientSideSearch\??:\s*boolean/);

    const loader = functionBody(component, loaderName);
    const guardIndex = loader.search(/if\s*\(\s*clientSideSearch\s*\)/);
    const fetchIndex = loader.indexOf("fetch(");
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(fetchIndex).toBeGreaterThan(guardIndex);
    expect(loader.slice(guardIndex, fetchIndex)).toMatch(/\breturn\b/);
  });
});

async function source(relativePath: string): Promise<string> {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function functionBody(contents: string, functionName: string): string {
  const start = contents.indexOf(`async function ${functionName}()`);
  expect(start, `${functionName} should exist`).toBeGreaterThanOrEqual(0);
  const end = contents.indexOf(`void ${functionName}();`, start);
  expect(end, `${functionName} should be invoked`).toBeGreaterThan(start);
  return contents.slice(start, end);
}
