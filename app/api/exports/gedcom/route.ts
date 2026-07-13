import { NextResponse } from "next/server";
import { exportGedcom } from "@/lib/gedcom/exporter";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const workspace = await readWorkspace();
    const result = exportGedcom({
      archiveName: workspace.archiveName,
      people: workspace.people,
      rawRecords: workspace.rawRecords,
      imports: workspace.imports
    });

    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    console.error("GEDCOM export failed", error);
    return NextResponse.json({ error: "GEDCOM export failed. Please retry or check the server logs." }, { status: 500 });
  }
}
