import { getAuth } from "./auth";
import { query } from "./db";
import { isHostedDeployment } from "./hosted-config";
import type { Role } from "./models";
import { resolvePublicDemoConfiguration } from "./public-demo-config";
import { resolvePublicDemoGuestIdentity } from "./public-demo-session-store";
import { readPublicDemoSessionToken } from "./public-demo-session-token";
import { ensureWorkspaceProvisioned, getArchiveId, type WorkspaceStoreOptions } from "./workspace-store";

export type MemberSessionContext = {
  kind: "member";
  userId: string;
  email: string;
  name: string;
  role: Role;
  archiveId: string;
};

export type DemoGuestSessionContext = {
  kind: "demo-guest";
  sessionId: string;
  archiveId: string;
  generation: number;
  expiresAt: string;
};

export type SessionContext = MemberSessionContext | DemoGuestSessionContext;

export function workspaceOptionsForSession(
  session: SessionContext
): WorkspaceStoreOptions & { archiveId: string } {
  if (session.kind === "member") {
    return { archiveId: session.archiveId };
  }
  return {
    archiveId: session.archiveId,
    demoGuestFence: {
      sessionId: session.sessionId,
      generation: session.generation
    }
  };
}

// Resolves the caller's identity and archive role from the better-auth
// session — never from request input. Returns null for anonymous callers and
// for authenticated users with no membership on the archive.
export async function getSessionContext(
  requestHeaders: Headers,
  options: WorkspaceStoreOptions = {}
): Promise<SessionContext | null> {
  // Local development without AUTH_SECRET keeps the workspace open, matching
  // the proxy's dev-open behavior; production fails closed there instead.
  if (!process.env.AUTH_SECRET && process.env.NODE_ENV !== "production") {
    return {
      kind: "member",
      userId: "dev",
      email: "dev@localhost",
      name: "Development",
      role: "owner",
      archiveId: getArchiveId(options)
    };
  }

  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    if (resolvePublicDemoConfiguration().enabled) {
      const token = readPublicDemoSessionToken(requestHeaders);
      if (token) {
        const guest = await resolvePublicDemoGuestIdentity(token, options);
        if (guest) return { kind: "demo-guest", ...guest };
      }
    }
    return null;
  }

  const hosted = isHostedDeployment();
  if (hosted && session.user.emailVerified !== true) {
    return null;
  }

  const archiveId = getArchiveId(options);
  const role = await resolveMembershipRole(session.user.id, archiveId, hosted, options);
  if (!role) {
    return null;
  }

  return {
    kind: "member",
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role,
    archiveId
  };
}

export async function countUsers(options: WorkspaceStoreOptions = {}): Promise<number> {
  const result = await query<{ total: number }>('SELECT count(*)::int AS total FROM "user"', [], options);
  return result.rows[0].total;
}

async function resolveMembershipRole(
  userId: string,
  archiveId: string,
  hosted: boolean,
  options: WorkspaceStoreOptions
): Promise<Role | null> {
  if (hosted) {
    // Acceptance is immutable evidence for the document version agreed at
    // onboarding. Pending invitations are invalidated when the release legal
    // manifest changes, but an approved update must not silently lock out the
    // existing cohort without a dedicated re-consent flow.
    const membership = await query<{ role: Role }>(
      `SELECT membership.role
       FROM public.memberships AS membership
       JOIN public.beta_terms_acceptances AS acceptance
         ON acceptance.archive_id = membership.archive_id
        AND acceptance.user_id = membership.user_id
       JOIN public.beta_invitations AS invitation
         ON invitation.id = acceptance.invitation_id
        AND invitation.archive_id = membership.archive_id
        AND invitation.consumed_by_user_id = membership.user_id
        AND invitation.state = 'consumed'
       WHERE membership.archive_id = $1
         AND membership.user_id = $2
       LIMIT 1`,
      [archiveId, userId],
      options
    );
    return membership.rows[0]?.role ?? null;
  }

  const membership = await query<{ role: Role }>(
    "SELECT role FROM memberships WHERE archive_id = $1 AND user_id = $2",
    [archiveId, userId],
    options
  );
  if (membership.rows[0]) {
    return membership.rows[0].role;
  }

  // Hosted accounts receive membership only through an operator-controlled
  // invitation or provisioning path. Never infer ownership from user order.
  // Self-hosted first-run self-heal: while the archive has no members yet, the
  // earliest-created account becomes owner (covers the browser closing between
  // sign-up and the explicit /api/setup/claim step). This is deterministic
  // even if concurrent first sign-ups slipped several accounts past the gate —
  // exactly one is the owner; every later account stays membership-less and is
  // denied by the proxy until invited. Once any membership exists, no other
  // account can self-heal.
  const archiveHasMembers = await query(
    "SELECT 1 FROM memberships WHERE archive_id = $1 LIMIT 1",
    [archiveId],
    options
  );
  if (archiveHasMembers.rows.length > 0) {
    return null;
  }

  const earliest = await query<{ id: string }>(
    'SELECT id FROM "user" ORDER BY "createdAt" ASC, id ASC LIMIT 1',
    [],
    options
  );
  if (earliest.rows[0]?.id !== userId) {
    return null;
  }

  await ensureWorkspaceProvisioned(options);
  await query(
    "INSERT INTO memberships (archive_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (archive_id, user_id) DO NOTHING",
    [archiveId, userId],
    options
  );
  return "owner";
}
