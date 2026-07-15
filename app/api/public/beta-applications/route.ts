import { handleBetaApplicationPost } from "@/lib/beta-application-http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleBetaApplicationPost(request);
}
