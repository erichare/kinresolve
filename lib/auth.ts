import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { createHostedPasswordRecovery, passwordResetTokenExpiresInSeconds } from "./auth-email";
import { getPool } from "./db";
import { isHostedDeployment } from "./hosted-config";

// Session lifetime: 30 days hard expiry, refreshed at most once a day. The
// proxy validates sessions but cannot forward refresh Set-Cookie headers.
// Defer refresh makes GET session checks read-only; Better Auth performs any
// refresh through its POST path, which the release fence can centrally block.
const sessionExpirySeconds = 60 * 60 * 24 * 30;
const sessionUpdateAgeSeconds = 60 * 60 * 24;

// Lazy singleton: getPool() requires DATABASE_URL, which is absent during
// `next build`, so the instance must not be constructed at module load.
function buildAuth() {
  const hosted = isHostedDeployment();
  const recovery = hosted ? createHostedPasswordRecovery() : undefined;

  return betterAuth({
    // better-auth wraps a node-postgres Pool in its own Kysely dialect.
    database: getPool(),
    secret: process.env.AUTH_SECRET,
    baseURL: process.env.APP_BASE_URL,
    emailAndPassword: {
      enabled: true,
      // Hosted membership is invitation-only and cannot create a session until
      // the address has been verified. Preserve the existing first-run and
      // optional-verification behavior for self-hosted installations.
      disableSignUp: hosted,
      requireEmailVerification: hosted,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      ...(recovery === undefined
        ? {}
        : {
            sendResetPassword: recovery.sendResetPassword,
            resetPasswordTokenExpiresIn: passwordResetTokenExpiresInSeconds,
            onPasswordReset: recovery.onPasswordReset,
            revokeSessionsOnPasswordReset: true
          })
    },
    // Password-reset verification identifiers contain bearer credentials.
    // Better Auth hashes them consistently at create, lookup, and consume.
    verification: {
      storeIdentifier: "hashed"
    },
    session: {
      expiresIn: sessionExpirySeconds,
      updateAge: sessionUpdateAgeSeconds,
      deferSessionRefresh: true,
      // Better Auth otherwise includes the database bearer token in session
      // JSON (including list-sessions). The HttpOnly cookie is the only browser
      // session credential; server APIs continue to use the token internally.
      additionalFields: {
        token: {
          type: "string",
          required: true,
          unique: true,
          fieldName: "token",
          returned: false
        }
      }
    },
    // Better Auth skips origin validation by default in NODE_ENV=test.
    // Opt in explicitly so the same CSRF boundary is enforced and exercised
    // in every environment.
    advanced: {
      disableOriginCheck: false,
      ...(recovery === undefined
        ? {}
        : { backgroundTasks: { handler: recovery.backgroundTaskHandler } })
    },
    // nextCookies must be last so Set-Cookie survives server-action calls.
    plugins: [nextCookies()]
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!instance) {
    instance = buildAuth();
  }
  return instance;
}
