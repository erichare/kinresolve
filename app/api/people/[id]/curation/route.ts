import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import type { PersonSummary, PrivacyLevel } from "@/lib/models";
import { updatePersonCuration } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const privacyLevels = new Set<PrivacyLevel>(["public", "private", "sensitive"]);
const livingStatuses = new Set<PersonSummary["livingStatus"]>(["living", "deceased", "unknown"]);

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withPermission("archive:publish", async (request, authorization, { params }: RouteContext) => {
  const { id } = await params;
  const personId = decodeURIComponent(id);
  const input = (await request.json()) as unknown;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const raw = input as Record<string, unknown>;

  if (Object.hasOwn(raw, "published") && typeof raw.published !== "boolean") {
    return NextResponse.json({ error: "Invalid published value" }, { status: 400 });
  }
  if (raw.privacy !== undefined && (typeof raw.privacy !== "string" || !privacyLevels.has(raw.privacy as PrivacyLevel))) {
    return NextResponse.json({ error: "Invalid privacy level" }, { status: 400 });
  }
  if (raw.livingStatus !== undefined && (typeof raw.livingStatus !== "string" || !livingStatuses.has(raw.livingStatus as PersonSummary["livingStatus"]))) {
    return NextResponse.json({ error: "Invalid living status" }, { status: 400 });
  }
  const body = {
    ...(Object.hasOwn(raw, "published") ? { published: raw.published as boolean } : {}),
    ...(raw.privacy !== undefined ? { privacy: raw.privacy as PrivacyLevel } : {}),
    ...(raw.livingStatus !== undefined ? { livingStatus: raw.livingStatus as PersonSummary["livingStatus"] } : {})
  };

  try {
    return NextResponse.json(await updatePersonCuration(personId, body, { archiveId: authorization.archiveId }));
  } catch {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }
});
