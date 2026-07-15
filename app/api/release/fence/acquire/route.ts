import { createReleaseFenceControlHandler } from "@/lib/release-fence-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createReleaseFenceControlHandler("acquire");
