import { NextResponse } from "next/server";
import { createImportSnapshot, diffImportSnapshots } from "@/lib/gedcom/importer";
import { applyGedcomImport } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { sourceName?: string; content?: string; previousContent?: string; apply?: boolean };

  if (!body.sourceName || !body.content) {
    return NextResponse.json({ error: "sourceName and content are required" }, { status: 400 });
  }

  const next = createImportSnapshot(body.sourceName, body.content);
  const diff = body.previousContent
    ? diffImportSnapshots(createImportSnapshot(`${body.sourceName}:previous`, body.previousContent), next)
    : undefined;

  return NextResponse.json({
    snapshot: {
      id: next.id,
      sourceName: next.sourceName,
      checksum: next.checksum,
      summary: next.summary,
      recordCount: next.records.length
    },
    diff,
    applied: body.apply ? await applyGedcomImport({ sourceName: body.sourceName, content: body.content }) : undefined
  }, { status: body.apply ? 201 : 200 });
}
