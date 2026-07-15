#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

import { resolveBetaApplicationCanaryEmail } from "./beta-application-canary-identity.ts";

const exactColumns = [
  "id",
  "submission_day",
  "submission_digest",
  "email_digest",
  "name",
  "email",
  "researcher_type",
  "workflow",
  "archive_size_band",
  "current_tool",
  "consent_version",
  "consented_at",
  "state",
  "applicant_delivery_state",
  "applicant_delivery_provider",
  "applicant_delivery_message_digest",
  "applicant_delivered_at",
  "founder_delivery_state",
  "founder_delivery_provider",
  "founder_delivery_message_digest",
  "founder_delivered_at",
  "delivery_attempt_count",
  "last_delivery_attempt_at",
  "created_at",
  "updated_at",
  "retention_expires_at"
];

const [mode, ...unexpected] = process.argv.slice(2);
if (!mode || unexpected.length > 0 || !["preflight", "verify-delete", "cleanup"].includes(mode)) {
  fail("Beta intake release canary arguments are invalid.");
}

const databaseUrl = required("MIGRATION_DATABASE_URL");
const emailPattern = required("BETA_APPLICATION_CANARY_EMAIL_PATTERN");
const emailFile = required("BETA_APPLICATION_CANARY_EMAIL_FILE");
const phase = required("BETA_APPLICATION_CANARY_PHASE");
const runId = required("BETA_APPLICATION_CANARY_RUN_ID");
const runAttempt = required("BETA_APPLICATION_CANARY_RUN_ATTEMPT");
const name = required("BETA_APPLICATION_CANARY_NAME");
const honeypotName = required("BETA_APPLICATION_CANARY_HONEYPOT_NAME");
let email;
try {
  email = resolveBetaApplicationCanaryEmail({
    pattern: emailPattern,
    phase,
    runAttempt,
    runId
  });
} catch {
  fail("Beta intake release canary configuration is invalid.");
}
const phaseTitle = phase === "staging" ? "Staging" : "Production";
if (
  !path.isAbsolute(emailFile)
  || name !== `Kin Resolve ${phaseTitle} Release Canary ${runId}-${runAttempt}`
  || honeypotName !== `${name} Honeypot`
) fail("Beta intake release canary configuration is invalid.");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
pool.on("error", () => undefined);

try {
  if (mode === "preflight") await preflight();
  if (mode === "verify-delete") await verifyAndDelete();
  if (mode === "cleanup") await cleanup();
  console.log(`Beta intake release canary ${mode} passed.`);
} catch {
  fail(`Beta intake release canary ${mode} failed.`);
} finally {
  await pool.end().catch(() => undefined);
}

async function preflight() {
  const [existing, columns] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS count
       FROM public.beta_applications
       WHERE email = $1 AND name = ANY($2::text[])`,
      [email, [name, honeypotName]]
    ),
    pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'beta_applications'
       ORDER BY ordinal_position`
    )
  ]);
  if (existing.rows[0]?.count !== 0) throw new Error();
  if (JSON.stringify(columns.rows.map(({ column_name }) => column_name)) !== JSON.stringify(exactColumns)) {
    throw new Error();
  }
  await writeFile(emailFile, `${email}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
}

async function verifyAndDelete() {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const result = await client.query(
      `SELECT id, name, email, researcher_type, current_tool, archive_size_band, workflow,
              consent_version, state, applicant_delivery_state, applicant_delivery_provider,
              applicant_delivery_message_digest, applicant_delivered_at,
              founder_delivery_state, founder_delivery_provider,
              founder_delivery_message_digest, founder_delivered_at,
              delivery_attempt_count,
              extract(epoch FROM (retention_expires_at - created_at))::int AS retention_seconds
       FROM public.beta_applications
       WHERE email = $1 AND name = ANY($2::text[])
       ORDER BY name
       FOR UPDATE`,
      [email, [name, honeypotName]]
    );
    if (result.rows.length !== 1) throw new Error();
    const row = result.rows[0];
    if (
      row.name !== name
      || row.email !== email
      || row.researcher_type !== "developer-self-hoster"
      || row.current_tool !== "gramps"
      || row.archive_size_band !== "prefer-not-to-say"
      || row.workflow !== "developer-api"
      || row.consent_version !== "beta-communications-v1"
      || row.state !== "pending"
      || row.retention_seconds !== 7_776_000
      || row.applicant_delivery_state !== "sent"
      || row.applicant_delivery_provider !== "resend"
      || row.founder_delivery_state !== "sent"
      || row.founder_delivery_provider !== "resend"
      || !/^[a-f0-9]{64}$/.test(row.applicant_delivery_message_digest ?? "")
      || !/^[a-f0-9]{64}$/.test(row.founder_delivery_message_digest ?? "")
      || row.applicant_delivered_at === null
      || row.founder_delivered_at === null
      || !Number.isInteger(row.delivery_attempt_count)
      || row.delivery_attempt_count < 1
    ) throw new Error();
    const deleted = await client.query(
      "DELETE FROM public.beta_applications WHERE id = $1::uuid",
      [row.id]
    );
    if (deleted.rowCount !== 1) throw new Error();
    await assertAbsent(client);
    await client.query("COMMIT");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

async function cleanup() {
  await pool.query(
    `DELETE FROM public.beta_applications
     WHERE email = $1 AND name = ANY($2::text[])`,
    [email, [name, honeypotName]]
  );
  await assertAbsent(pool);
}

async function assertAbsent(client) {
  const absent = await client.query(
    `SELECT count(*)::int AS count
     FROM public.beta_applications
     WHERE email = $1 AND name = ANY($2::text[])`,
    [email, [name, honeypotName]]
  );
  if (absent.rows[0]?.count !== 0) throw new Error();
}

function required(name) {
  const value = process.env[name];
  if (!value || value !== value.trim()) fail("Beta intake release canary configuration is invalid.");
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
