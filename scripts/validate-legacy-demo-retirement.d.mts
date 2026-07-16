export type LegacyDemoRetirementEnvironment = Readonly<Record<string, string | undefined>>;

export function validateLegacyDemoRetirement(
  environment?: LegacyDemoRetirementEnvironment,
  fetchImplementation?: typeof fetch
): Promise<Readonly<{ workflowId: string; state: "disabled_manually" }>>;
