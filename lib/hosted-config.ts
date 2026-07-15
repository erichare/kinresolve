export const deploymentModes = ["self-hosted", "hosted"] as const;
export const datasetModes = ["empty", "demo", "pilot"] as const;

export type DeploymentMode = (typeof deploymentModes)[number];
export type DatasetMode = (typeof datasetModes)[number];

export type DatasetConfiguration = {
  deploymentMode: DeploymentMode;
  datasetMode: DatasetMode;
  explicitDatasetMode: boolean;
};

type Environment = Record<string, string | undefined>;

export function resolveDatasetConfiguration(environment: Environment = process.env): DatasetConfiguration {
  const configuredDeploymentMode = normalized(environment.KINRESOLVE_DEPLOYMENT_MODE);
  const vercelProduction = normalized(environment.VERCEL_ENV) === "production" ||
    (normalized(environment.VERCEL) === "1" && normalized(environment.NODE_ENV) === "production");

  if (!configuredDeploymentMode && vercelProduction) {
    throw new Error("KINRESOLVE_DEPLOYMENT_MODE is required for the Vercel production runtime.");
  }

  const deploymentMode = configuredDeploymentMode || "self-hosted";
  if (!isOneOf(deploymentMode, deploymentModes)) {
    throw new Error("KINRESOLVE_DEPLOYMENT_MODE must be self-hosted or hosted.");
  }

  const configuredDatasetMode = normalized(environment.KINRESOLVE_DATASET_MODE);
  if (!configuredDatasetMode && deploymentMode === "hosted") {
    throw new Error("KINRESOLVE_DATASET_MODE is required for a hosted deployment.");
  }

  const datasetMode = configuredDatasetMode || "demo";
  if (!isOneOf(datasetMode, datasetModes)) {
    throw new Error("KINRESOLVE_DATASET_MODE must be empty, demo, or pilot.");
  }

  return {
    deploymentMode,
    datasetMode,
    explicitDatasetMode: Boolean(configuredDatasetMode)
  };
}

export function isHostedDeployment(environment: Environment = process.env): boolean {
  return resolveDatasetConfiguration(environment).deploymentMode === "hosted";
}

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isOneOf<T extends string>(value: string, choices: readonly T[]): value is T {
  return choices.some((choice) => choice === value);
}
