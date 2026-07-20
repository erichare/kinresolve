import { pathToFileURL } from "node:url";

import { provisionArchive } from "../lib/archive-provisioning";
import {
  archiveIdEnvironmentAlias,
  describeEnvironmentAliasPair,
  readArchiveIdSetting
} from "../lib/environment-aliases";
import { datasetModes, resolveDatasetConfiguration, type DatasetMode } from "../lib/hosted-config";

type Environment = Record<string, string | undefined>;

export function resolveProvisioningMode(argv: string[], environment: Environment): DatasetMode {
  const configuredMode = environment.KINRESOLVE_DATASET_MODE?.trim().toLowerCase();

  if (argv.length === 0) {
    if (!configuredMode) {
      throw new Error("Archive provisioning requires an explicit --mode or KINRESOLVE_DATASET_MODE setting.");
    }
    return resolveDatasetConfiguration(environment).datasetMode;
  }

  if (argv[0] !== "--mode") {
    throw new Error("Archive provisioning accepts only --mode <empty|demo|pilot>.");
  }
  if (argv.length === 1) {
    throw new Error("--mode requires a value.");
  }
  if (argv.length !== 2) {
    throw new Error("Archive provisioning accepts only one --mode argument.");
  }

  const requestedMode = argv[1]?.trim().toLowerCase() ?? "";
  if (!isDatasetMode(requestedMode)) {
    throw new Error("Archive provisioning mode must be empty, demo, or pilot.");
  }
  if (configuredMode) {
    const configuration = resolveDatasetConfiguration(environment);
    if (configuration.datasetMode !== requestedMode) {
      throw new Error(
        `The deployment is configured as ${configuration.datasetMode}, but provisioning requested ${requestedMode}.`
      );
    }
  }
  return requestedMode;
}

export async function runProvisioningCommand(
  argv: string[] = process.argv.slice(2),
  environment: Environment = process.env
): Promise<void> {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for archive provisioning.");
  }
  const archiveId = readArchiveIdSetting(environment)?.trim();
  if (!archiveId) {
    throw new Error(
      `${describeEnvironmentAliasPair(archiveIdEnvironmentAlias)} is required for archive provisioning.`
    );
  }

  const datasetMode = resolveProvisioningMode(argv, environment);
  const result = await provisionArchive(datasetMode, { databaseUrl, archiveId, datasetMode });
  const action = result.created ? "Provisioned" : "Verified";
  console.log(
    `${action} ${result.datasetMode} archive ${result.archiveId}` +
      (result.demoFixtureVersion === null ? "." : ` with demo fixture version ${result.demoFixtureVersion}.`)
  );
}

function isDatasetMode(value: string): value is DatasetMode {
  return datasetModes.some((mode) => mode === value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProvisioningCommand().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
