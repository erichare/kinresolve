import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public demo lifecycle hardening", () => {
  it("serializes global AI admission before counting concurrent and daily usage", async () => {
    const reserve = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function reservePublicDemoAiAttempt",
      "export async function completePublicDemoAiAttempt"
    );

    expect(reserve).toContain("lockCapacity(client)");
    expect(reserve.indexOf("lockCapacity(client)")).toBeLessThan(reserve.indexOf("count(*) FILTER"));
  });

  it("types the event timestamp before calculating retention", async () => {
    const recordEvent = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function recordPublicDemoEvent",
      "export async function reservePublicDemoAiAttempt"
    );

    expect(recordEvent).toMatch(/\$8::timestamptz\s*\+\s*interval '30 days'/);
  });

  it("keys the durable stats increment on the admitted outcome event insert", async () => {
    const recordEvent = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function recordPublicDemoEvent",
      "export async function reservePublicDemoAiAttempt"
    );

    expect(recordEvent).toMatch(/WITH inserted_event AS \(\s*INSERT INTO public\.public_demo_events/);
    expect(recordEvent).toMatch(/outcomes_completed_total\s*=\s*stats\.outcomes_completed_total \+ 1/);
    expect(recordEvent).toMatch(
      /EXISTS \(\s*SELECT 1 FROM inserted_event\s*WHERE inserted_event\.event_name = 'outcome_completed'\s*\)/
    );
    expect(recordEvent.indexOf("is_canary = false")).toBeLessThan(
      recordEvent.indexOf("UPDATE public.public_demo_stats")
    );
  });

  it("types the AI timestamp before the UTC day boundary and lease arithmetic", async () => {
    const reserve = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function reservePublicDemoAiAttempt",
      "export async function completePublicDemoAiAttempt"
    );

    expect.soft(reserve).toMatch(
      /date_trunc\(\s*'day',\s*\$1::timestamptz\s+AT TIME ZONE 'UTC'\s*\)/
    );
    expect.soft(reserve).toMatch(/\$6::timestamptz\s*\+\s*interval '30 seconds'/);
  });

  it("types the diagnostic timestamp before stale-session arithmetic", async () => {
    const diagnostics = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function readPublicDemoDiagnostics",
      "export async function cleanupPublicDemoSessions"
    );

    expect(diagnostics).toMatch(/session\.updated_at\s*<=\s*\$1::timestamptz\s*-\s*interval '2 minutes'/);
    expect(diagnostics).toMatch(
      /cleanup_lease_expires_at\s*>\s*clock_timestamp\(\)\s+AS cleanup_lease_held/
    );
  });

  it("types cleanup timestamps before stale-session, stale-generation, and retention arithmetic", async () => {
    const cleanup = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function cleanupPublicDemoSessions",
      "async function activateProvisionedSession"
    );

    expect.soft(cleanup.match(/\$1::timestamptz\s*-\s*interval '2 minutes'/g) ?? []).toHaveLength(2);
    expect.soft(cleanup).toMatch(/ended_at\s*<=\s*\$1::timestamptz\s*-\s*interval '30 days'/);
  });

  it("prevents a successful reset while a provider attempt still leases the generation", async () => {
    const reset = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function resetPublicDemoSession",
      "export async function endPublicDemoSession"
    );
    const leaseFence = await functionSource(
      "lib/public-demo-session-store.ts",
      "async function assertNoActiveAiLease",
      "async function readSessionState"
    );

    expect(reset).toContain("assertNoActiveAiLease");
    expect(leaseFence).toMatch(/public_demo_ai_attempts[\s\S]*state = 'running'[\s\S]*lease_expires_at/);
    expect(leaseFence).toMatch(/AI.*in progress|active AI/i);
  });

  it("deletes cleaned lifecycle metadata after 30 days", async () => {
    const cleanup = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function cleanupPublicDemoSessions",
      "async function activateProvisionedSession"
    );

    expect(cleanup).toMatch(/DELETE FROM public\.public_demo_sessions[\s\S]*interval '30 days'/);
  });

  it("turns away brand-new starts with an unlocked fast path before the capacity lock", async () => {
    const start = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function startPublicDemoSession",
      "export async function resetPublicDemoSession"
    );

    // The cheap unlocked count runs only for token-less requests and sits
    // before the reservation transaction; the authoritative locked decision
    // (decidePublicDemoAdmission after lockCapacity) is unchanged.
    const fastPath = start.indexOf("if (!input.rawToken) {");
    const reservation = start.indexOf("const reserved = await withTransaction");
    const lockedDecision = start.indexOf("decidePublicDemoAdmission");
    expect(fastPath).toBeGreaterThan(-1);
    expect(fastPath).toBeLessThan(reservation);
    expect(reservation).toBeLessThan(lockedDecision);
    expect(start.slice(fastPath, reservation)).toMatch(
      /count\(\*\)::int AS occupied[\s\S]*status IN \('active', 'provisioning'\)/
    );
    expect(start.slice(fastPath, reservation)).not.toMatch(/FOR UPDATE|lockCapacity/);
    expect(start.slice(fastPath, reservation)).toContain('eventName: "capacity_rejected"');

    // Bounded reservation waits map storms onto the start route's existing
    // 503 retry path instead of stacking transactions behind the lock.
    const reservationBody = start.slice(reservation, lockedDecision);
    expect(reservationBody).toContain("SET LOCAL lock_timeout = '2s'");
    expect(reservationBody).toContain("SET LOCAL statement_timeout = '5s'");
    expect(reservationBody.indexOf("SET LOCAL lock_timeout")).toBeLessThan(
      reservationBody.indexOf("lockCapacity(client)")
    );
  });

  it("does not consume a new-session network bucket when capacity is already full", async () => {
    const start = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function startPublicDemoSession",
      "export async function resetPublicDemoSession"
    );

    expect(start.indexOf("decidePublicDemoAdmission")).toBeLessThan(
      start.indexOf("consumePublicDemoNetworkRateLimit")
    );
  });

  it("bypasses only the network bucket for an authorized canary while preserving capacity admission", async () => {
    const start = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function startPublicDemoSession",
      "export async function resetPublicDemoSession"
    );

    const capacityAdmission = start.indexOf("decidePublicDemoAdmission");
    const canaryBranch = start.indexOf("input.isCanary", capacityAdmission);
    const ordinaryNetworkBucket = start.indexOf("consumePublicDemoNetworkRateLimit", canaryBranch);

    expect(capacityAdmission).toBeGreaterThan(-1);
    expect(canaryBranch).toBeGreaterThan(capacityAdmission);
    expect(ordinaryNetworkBucket).toBeGreaterThan(canaryBranch);
    expect(start.slice(canaryBranch, ordinaryNetworkBucket)).toMatch(/allowed:\s*true/);
    expect(start).toContain("input.networkSubjectDigest");
  });

  it("reserves a reset generation before provisioning and fails the reservation on error", async () => {
    const reset = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function resetPublicDemoSession",
      "export async function endPublicDemoSession"
    );

    const reserve = reset.indexOf("INSERT INTO public.public_demo_generations");
    const provision = reset.indexOf("provisionArchive");
    expect(reserve).toBeGreaterThan(-1);
    expect(reserve).toBeLessThan(provision);
    expect(reset).toMatch(/public_demo_generations[\s\S]*'provisioning'/);
    expect(reset).toContain("failResetGeneration");
    const failReservation = await functionSource(
      "lib/public-demo-session-store.ts",
      "async function failResetGeneration",
      "async function assertNoActiveAiLease"
    );
    expect(failReservation).toMatch(/SET state = 'failed'[\s\S]*state = 'provisioning'/);
    expect(reset).toMatch(/SET state = 'active'[\s\S]*generation/);
  });

  it("deletes archives only after checking fixture mode, generation state, and live references", async () => {
    const remove = await functionSource(
      "lib/public-demo-session-store.ts",
      "async function deletePublicDemoArchive",
      "function publicDemoArchiveId"
    );

    expect(remove).toMatch(/dataset_mode\s*=\s*'demo'/);
    expect(remove).toMatch(/state IN \('retired', 'failed'\)/);
    expect(remove).toMatch(/status IN \('active', 'provisioning'\)/);
    expect(remove).toContain("FOR UPDATE");
  });

  it("records cleanup completion only on success and persists a failure timestamp", async () => {
    const cleanup = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function cleanupPublicDemoSessions",
      "async function activateProvisionedSession"
    );

    expect(cleanup).toContain("last_cleanup_failed_at");
    expect(cleanup).toMatch(/last_cleanup_completed_at\s*=\s*clock_timestamp\(\)/);
    expect(cleanup).not.toMatch(/finally[\s\S]*last_cleanup_completed_at\s*=\s*\$[0-9]+/);
  });
});

async function functionSource(relativePath: string, start: string, end: string): Promise<string> {
  const contents = await readFile(path.join(process.cwd(), relativePath), "utf8");
  return contents.slice(contents.indexOf(start), contents.indexOf(end));
}
