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

  it("prevents a successful reset while a provider attempt still leases the generation", async () => {
    const reset = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function resetPublicDemoSession",
      "export async function endPublicDemoSession"
    );

    expect(reset).toMatch(/public_demo_ai_attempts[\s\S]*state = 'running'[\s\S]*lease_expires_at/);
    expect(reset).toMatch(/AI.*in progress|active AI/i);
  });

  it("deletes cleaned lifecycle metadata after 30 days", async () => {
    const cleanup = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function cleanupPublicDemoSessions",
      "async function activateProvisionedSession"
    );

    expect(cleanup).toMatch(/DELETE FROM public\.public_demo_sessions[\s\S]*interval '30 days'/);
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
    expect(reset).toMatch(/SET state = 'failed'[\s\S]*state = 'provisioning'/);
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
