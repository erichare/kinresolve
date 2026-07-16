export type PublicDemoInternalHealthEnvironment = Readonly<Record<string, string | undefined>>;

export type PublicDemoInternalHealthResult = Readonly<{
  active: number;
  occupied: number;
  dailyAiUsed: number;
}>;

export function runPublicDemoInternalHealthMonitor(
  environment?: PublicDemoInternalHealthEnvironment,
  fetchImplementation?: typeof fetch
): Promise<PublicDemoInternalHealthResult>;
