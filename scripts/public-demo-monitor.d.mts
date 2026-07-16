export type PublicDemoMonitorMode = "shallow" | "full";

export type PublicDemoMonitorEnvironment = Readonly<Record<string, string | undefined>>;

export type PublicDemoMonitorResult = Readonly<{
  mode: PublicDemoMonitorMode;
  shallowProbeCount: number;
}>;

export function runPublicDemoMonitor(
  mode: PublicDemoMonitorMode,
  environment?: PublicDemoMonitorEnvironment,
  fetchImplementation?: typeof fetch
): Promise<PublicDemoMonitorResult>;
