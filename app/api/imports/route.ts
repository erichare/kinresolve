import { NextResponse } from "next/server";
import { createImportSnapshot, diffImportSnapshots } from "@/lib/gedcom/importer";
import { applyGedcomImport } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readImportRequest(request);

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

async function readImportRequest(request: Request): Promise<{ sourceName?: string; content?: string; previousContent?: string; apply?: boolean }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const previousFile = formData.get("previousFile");
    const sourceName = getFormText(formData, "sourceName") || (file instanceof File ? file.name : undefined);

    return {
      sourceName,
      content: file instanceof File ? await file.text() : getFormText(formData, "content"),
      previousContent: previousFile instanceof File ? await previousFile.text() : getFormText(formData, "previousContent"),
      apply: getFormText(formData, "apply") === "true"
    };
  }

  return (await request.json()) as { sourceName?: string; content?: string; previousContent?: string; apply?: boolean };
}

function getFormText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
