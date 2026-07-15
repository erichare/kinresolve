import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { resolveProvisioningMode } from "@/scripts/provision-archive-command";

describe("archive provisioning command", () => {
  it.each(["empty", "demo", "pilot"] as const)("accepts an explicit --mode %s", (datasetMode) => {
    expect(resolveProvisioningMode(["--mode", datasetMode], {})).toBe(datasetMode);
  });

  it("accepts an explicitly configured dataset mode", () => {
    expect(
      resolveProvisioningMode([], {
        KINRESOLVE_DEPLOYMENT_MODE: "hosted",
        KINRESOLVE_DATASET_MODE: "pilot"
      })
    ).toBe("pilot");
  });

  it("requires an explicit mode instead of inheriting the self-hosted demo default", () => {
    expect(() => resolveProvisioningMode([], {})).toThrow(/explicit.*mode/i);
  });

  it("rejects invalid arguments and configuration disagreement", () => {
    expect(() => resolveProvisioningMode(["demo"], {})).toThrow(/--mode/i);
    expect(() => resolveProvisioningMode(["--mode", "seed"], {})).toThrow(/empty, demo, or pilot/i);
    expect(() => resolveProvisioningMode(["--mode"], {})).toThrow(/value/i);
    expect(() =>
      resolveProvisioningMode(["--mode", "demo"], {
        KINRESOLVE_DEPLOYMENT_MODE: "hosted",
        KINRESOLVE_DATASET_MODE: "pilot"
      })
    ).toThrow(/configured.*pilot.*requested.*demo/i);
  });

  it("publishes one package command through the plain JavaScript launcher", async () => {
    const [packageSource, launcherSource] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("scripts/provision-archive.mjs", "utf8")
    ]);
    const packageJson = JSON.parse(packageSource) as { scripts: Record<string, string> };

    expect(packageJson.scripts["archive:provision"]).toBe("node scripts/provision-archive.mjs");
    expect(launcherSource).toContain('"--import", "tsx", "scripts/provision-archive-command.ts"');
  });
});
