import { resolveDatasetConfiguration } from "./hosted-config";

type Environment = Record<string, string | undefined>;

export type PublicDemoConfiguration = {
  enabled: boolean;
  origin: "https://demo.kinresolve.com" | null;
  sessionDurationSeconds: 86_400;
  maximumActiveSessions: 25;
  maximumResets: 5;
  aiAttemptsPerSession: 3;
};

const canonicalPublicDemoOrigin = "https://demo.kinresolve.com" as const;

const policy = {
  sessionDurationSeconds: 86_400,
  maximumActiveSessions: 25,
  maximumResets: 5,
  aiAttemptsPerSession: 3
} as const;

export function resolvePublicDemoConfiguration(
  environment: Environment = process.env
): PublicDemoConfiguration {
  const rawEnabled = environment.KINRESOLVE_PUBLIC_DEMO_ENABLED?.trim() ?? "";
  if (rawEnabled !== "" && rawEnabled !== "true" && rawEnabled !== "false") {
    throw new Error("KINRESOLVE_PUBLIC_DEMO_ENABLED must be exactly true or false.");
  }

  const enabled = rawEnabled === "true";
  if (!enabled) {
    return { enabled: false, origin: null, ...policy };
  }

  const dataset = resolveDatasetConfiguration(environment);
  if (dataset.deploymentMode !== "hosted" || dataset.datasetMode !== "demo") {
    throw new Error("The public demo requires a hosted deployment with the demo dataset.");
  }

  const origin = environment.KINRESOLVE_PUBLIC_DEMO_ORIGIN?.trim();
  if (origin !== canonicalPublicDemoOrigin) {
    throw new Error(
      `KINRESOLVE_PUBLIC_DEMO_ORIGIN must be exactly ${canonicalPublicDemoOrigin} when the public demo is enabled.`
    );
  }

  return { enabled: true, origin: canonicalPublicDemoOrigin, ...policy };
}

export function publicDemoEnabled(environment: Environment = process.env): boolean {
  return resolvePublicDemoConfiguration(environment).enabled;
}
