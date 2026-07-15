import { resolveDatasetConfiguration } from "./hosted-config";

type Environment = Record<string, string | undefined>;

export type ScheduledWritesConfiguration = {
  configured: boolean;
  enabled: boolean;
};

export type ScheduledWritesStatus = ScheduledWritesConfiguration & {
  valid: boolean;
};

export function resolveScheduledWritesConfiguration(
  environment: Environment = process.env
): ScheduledWritesConfiguration {
  const { deploymentMode } = resolveDatasetConfiguration(environment);
  const raw = environment.KINRESOLVE_SCHEDULED_WRITES_ENABLED?.trim().toLowerCase() ?? "";

  if (!raw) {
    if (deploymentMode === "hosted") {
      throw new Error("KINRESOLVE_SCHEDULED_WRITES_ENABLED is required for a hosted deployment.");
    }
    return { configured: false, enabled: true };
  }
  if (raw !== "true" && raw !== "false") {
    throw new Error("KINRESOLVE_SCHEDULED_WRITES_ENABLED must be exactly true or false.");
  }
  return { configured: true, enabled: raw === "true" };
}

export function getScheduledWritesStatus(environment: Environment = process.env): ScheduledWritesStatus {
  try {
    return { valid: true, ...resolveScheduledWritesConfiguration(environment) };
  } catch {
    return {
      valid: false,
      configured: Boolean(environment.KINRESOLVE_SCHEDULED_WRITES_ENABLED?.trim()),
      enabled: false
    };
  }
}
