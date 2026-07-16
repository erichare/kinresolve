import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowNames = [
  "vercel-holding.yml",
  "vercel-release.yml",
  "release-containment.yml",
  "recovery-evidence.yml"
] as const;

const canonicalModes = ["holding", "containment", "promoted"] as const;

describe("Vercel canonical hostname lookup workflow contract", () => {
  it.each(workflowNames)(
    "%s binds every canonical response validator to APP_BASE_URL's exact hostname",
    async (workflowName) => {
      const contents = await readFile(
        path.join(process.cwd(), ".github", "workflows", workflowName),
        "utf8"
      );
      const lines = contents.split("\n");
      const invocationLines = lines.flatMap((line, index) => canonicalModes.some(
        (mode) => line.includes(`scripts/validate-vercel-deployment.mjs ${mode}`)
      ) ? [index] : []);

      expect(invocationLines.length).toBeGreaterThan(0);
      for (const index of invocationLines) {
        const invocation = lines.slice(index, index + 4).join("\n");
        expect(invocation).toContain('"${APP_BASE_URL#https://}"');
      }
    }
  );
});
