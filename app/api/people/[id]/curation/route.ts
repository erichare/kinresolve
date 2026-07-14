import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import type { PersonSummary, PrivacyLevel } from "@/lib/models";
import { updatePersonCuration } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const privacyLevels = new Set<PrivacyLevel>(["public", "private", "sensitive"]);
const livingStatuses = new Set<PersonSummary["livingStatus"]>(["living", "deceased", "unknown"]);

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withPermission("archive:publish", async (request, _authorization, { params }: RouteContext) => {
  const { id } = await params;
  const personId = decodeURIComponent(id);
  const body = (await request.json()) as { published?: boolean; privacy?: PrivacyLevel; livingStatus?: PersonSummary["livingStatus"] };

  if (body.privacy && !privacyLevels.has(body.privacy)) {
    return NextResponse.json({ error: "Invalid privacy level" }, { status: 400 });
  }
  if (body.livingStatus && !livingStatuses.has(body.livingStatus)) {
    return NextResponse.json({ error: "Invalid living status" }, { status: 400 });
  }

  try {
    return NextResponse.json(await updatePersonCuration(personId, body));
  } catch {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }
});
