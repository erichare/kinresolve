import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The client performs this same-origin mutation with fetch, then chooses the
// exact relative /login destination itself. Keep the server result explicit:
// success means this route independently confirmed the exact server session
// is absent while preserving Better Auth's cookie updates.
export async function POST(request: NextRequest) {
  try {
    const auth = getAuth();
    const current = await auth.api.getSession({ headers: request.headers });
    const sessionIdentity = current
      ? { id: current.session.id, userId: current.user.id }
      : null;
    if (sessionIdentity && (!sessionIdentity.id || !sessionIdentity.userId)) {
      throw new Error("The active session identity is malformed");
    }
    const signOut = await auth.api.signOut({ headers: request.headers, asResponse: true });
    if (!signOut.ok) throw new Error("Sign-out was not confirmed");
    if (sessionIdentity) {
      await withTransaction({}, async (client) => {
        await client.query(
          'DELETE FROM public."session" WHERE id = $1 AND "userId" = $2',
          [sessionIdentity.id, sessionIdentity.userId]
        );
        const verification = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM public."session" WHERE id = $1 AND "userId" = $2',
          [sessionIdentity.id, sessionIdentity.userId]
        );
        if (verification.rows[0]?.count !== "0") {
          throw new Error("Server-side session revocation was not confirmed");
        }
      });
    }
    const response = new NextResponse(null, {
      status: 204,
      headers: { "cache-control": "private, no-store" }
    });
    for (const cookie of signOut.headers.getSetCookie()) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  } catch {
    return apiErrorResponse(503, "Sign-out could not be confirmed", {
      headers: { "cache-control": "private, no-store" }
    });
  }
}
