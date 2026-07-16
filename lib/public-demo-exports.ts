import { createHash } from "node:crypto";

import { exportGedcom } from "./gedcom/exporter";
import type { WorkspaceData } from "./workspace-store";

const fictionalDemoNotice =
  "Fictional demo material. Every person, record, citation, and research conclusion is synthetic.";

export type PublicDemoExportResult = Readonly<{
  content: string;
  fileName: string;
  manifestDigest: string;
}>;

export function createPublicDemoGedcomExport(
  workspace: WorkspaceData,
  now = new Date()
): PublicDemoExportResult {
  const exported = exportGedcom({
    archiveName: "Kin Resolve fictional demo family",
    people: workspace.people,
    rawRecords: workspace.rawRecords,
    imports: workspace.imports
  }, { now });
  const content = exported.content
    .replace(/^1 SOUR KINSLEUTH$/m, "1 SOUR KINRESOLVE-DEMO")
    .replace(/^2 NAME KinSleuth$/m, "2 NAME Kin Resolve fictional demo")
    .replace(/^0 HEAD\n/, `0 HEAD\n1 NOTE ${fictionalDemoNotice}\n`);
  const fileName = `kin-resolve-fictional-demo-${isoDate(now)}.ged`;

  return {
    content,
    fileName,
    manifestDigest: sha256(content)
  };
}

export function createPublicDemoResearchArchiveExport(
  workspace: WorkspaceData,
  now = new Date()
): PublicDemoExportResult {
  const data = {
    archive: {
      version: workspace.version,
      name: workspace.archiveName,
      tagline: workspace.archiveTagline,
      updatedAt: workspace.updatedAt,
      people: workspace.people,
      cases: workspace.cases,
      sources: workspace.sources.map(({ storageKey: _storageKey, ...source }) => source),
      dnaMatches: workspace.dnaMatches,
      imports: workspace.imports,
      rawRecords: workspace.rawRecords
    }
  };
  const generatedAt = now.toISOString();
  const bundle = {
    manifest: {
      schemaVersion: 1,
      product: "Kin Resolve",
      exportType: "fictional-demo-research",
      fictional: true,
      notice: fictionalDemoNotice,
      generatedAt,
      dataSha256: sha256(JSON.stringify(data)),
      excludedClasses: [
        "real-family-data",
        "accounts-memberships-and-contact-details",
        "sessions-cookies-and-demo-rate-limit-subjects",
        "provider-credentials-and-diagnostics",
        "ai-prompts-outputs-and-history",
        "backup-and-object-storage-locators"
      ]
    },
    data
  };
  const content = `${JSON.stringify(bundle, null, 2)}\n`;

  return {
    content,
    fileName: `kin-resolve-fictional-demo-${isoDate(now)}.json`,
    manifestDigest: sha256(content)
  };
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
