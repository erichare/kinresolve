import { readFile } from "node:fs/promises";
import path from "node:path";

export const EXPECTED_VERCEL_DEPLOYMENT_CONFIG = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: "nextjs",
  git: {
    deploymentEnabled: false
  },
  regions: ["sfo1"],
  crons: [
    {
      path: "/api/cron/integration-jobs",
      schedule: "*/5 * * * *"
    },
    {
      path: "/api/cron/import-uploads",
      schedule: "17 7 * * *"
    }
  ]
} as const;

export type VercelDeploymentConfig = {
  $schema: typeof EXPECTED_VERCEL_DEPLOYMENT_CONFIG.$schema;
  framework: typeof EXPECTED_VERCEL_DEPLOYMENT_CONFIG.framework;
  git: {
    deploymentEnabled: false;
  };
  regions: ["sfo1"];
  crons: [
    { path: "/api/cron/integration-jobs"; schedule: "*/5 * * * *" },
    { path: "/api/cron/import-uploads"; schedule: "17 7 * * *" }
  ];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const expectedKeys = new Set(expected);
  const extra = Object.keys(value).filter((key) => !expectedKeys.has(key)).sort();
  if (extra.length > 0) {
    throw new Error(`${label} contains unexpected field ${extra[0]}.`);
  }
  const missing = expected.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new Error(`${label} is missing required field ${missing[0]}.`);
  }
}

function requireExactString(value: unknown, expected: string, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must be exactly ${expected}.`);
  }
}

export function validateVercelDeploymentConfig(value: unknown): VercelDeploymentConfig {
  const config = requireRecord(value, "Vercel deployment config");
  requireExactKeys(config, ["$schema", "framework", "git", "regions", "crons"], "Vercel deployment config");
  requireExactString(
    config.$schema,
    EXPECTED_VERCEL_DEPLOYMENT_CONFIG.$schema,
    "Vercel deployment config $schema"
  );
  requireExactString(
    config.framework,
    EXPECTED_VERCEL_DEPLOYMENT_CONFIG.framework,
    "Vercel deployment config framework"
  );

  const git = requireRecord(config.git, "Vercel deployment config git");
  requireExactKeys(git, ["deploymentEnabled"], "Vercel deployment config git");
  if (git.deploymentEnabled !== false) {
    throw new Error("Vercel deployment config git.deploymentEnabled must be exactly false.");
  }

  if (
    !Array.isArray(config.regions) ||
    config.regions.length !== EXPECTED_VERCEL_DEPLOYMENT_CONFIG.regions.length ||
    config.regions.some((region, index) => region !== EXPECTED_VERCEL_DEPLOYMENT_CONFIG.regions[index])
  ) {
    throw new Error("Vercel deployment config regions must be exactly [sfo1].");
  }

  if (!Array.isArray(config.crons) || config.crons.length !== EXPECTED_VERCEL_DEPLOYMENT_CONFIG.crons.length) {
    throw new Error("Vercel deployment config crons must contain exactly the reviewed production definitions.");
  }
  for (const [index, expectedCron] of EXPECTED_VERCEL_DEPLOYMENT_CONFIG.crons.entries()) {
    const label = `Vercel deployment config cron ${index + 1}`;
    const cron = requireRecord(config.crons[index], label);
    requireExactKeys(cron, ["path", "schedule"], label);
    requireExactString(cron.path, expectedCron.path, `${label} path`);
    requireExactString(cron.schedule, expectedCron.schedule, `${label} schedule`);
  }

  return {
    $schema: EXPECTED_VERCEL_DEPLOYMENT_CONFIG.$schema,
    framework: EXPECTED_VERCEL_DEPLOYMENT_CONFIG.framework,
    git: { deploymentEnabled: false },
    regions: ["sfo1"],
    crons: [
      { path: "/api/cron/integration-jobs", schedule: "*/5 * * * *" },
      { path: "/api/cron/import-uploads", schedule: "17 7 * * *" }
    ]
  };
}

export async function loadVercelDeploymentConfig(repositoryRoot: string): Promise<VercelDeploymentConfig> {
  const configPath = path.join(repositoryRoot, "vercel.json");
  let contents: string;
  try {
    contents = await readFile(configPath, "utf8");
  } catch (error) {
    throw new Error("Repository vercel.json is missing or unreadable.", { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error("Repository vercel.json is not valid JSON.", { cause: error });
  }
  return validateVercelDeploymentConfig(parsed);
}
