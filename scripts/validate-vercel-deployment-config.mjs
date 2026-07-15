#!/usr/bin/env node
import { loadVercelDeploymentConfig } from "../lib/vercel-deployment-config.ts";

if (process.argv.length !== 2) {
  console.error("Vercel deployment config validation does not accept alternate files or arguments.");
  process.exit(1);
}

try {
  const config = await loadVercelDeploymentConfig(process.cwd());
  console.log(
    `Verified Vercel deployment guard: Git deployments disabled, region ${config.regions[0]}, ${config.crons.length} exact cron definitions.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
