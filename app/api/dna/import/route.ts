import { NextResponse } from "next/server";
import { parseCsvRows } from "@/lib/csv";
import { mapDnaCsvRows } from "@/lib/dna-import";
import { saveDnaMatches } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const csv = await readCsvRequest(request);

  if (!csv.trim()) {
    return NextResponse.json({ error: "CSV content or file is required" }, { status: 400 });
  }

  const mapped = mapDnaCsvRows(parseCsvRows(csv));

  if (mapped.matches.length === 0) {
    return NextResponse.json({ error: "No importable DNA matches found", skipped: mapped.skipped }, { status: 400 });
  }

  const results = await saveDnaMatches(mapped.matches);

  return NextResponse.json(
    {
      imported: results.length,
      skipped: mapped.skipped,
      matches: results.map((result) => result.match),
      hypotheses: results.map((result) => result.hypothesis)
    },
    { status: 201 }
  );
}

async function readCsvRequest(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const csv = formData.get("csv");

    if (file instanceof File) {
      return file.text();
    }

    return typeof csv === "string" ? csv : "";
  }

  const body = (await request.json()) as { csv?: string };
  return body.csv ?? "";
}
