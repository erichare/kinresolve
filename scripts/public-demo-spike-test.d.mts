export type PublicDemoSpikeTestEnvironment = Readonly<Record<string, string | undefined>>;

export type PublicDemoSpikeTestResult = Readonly<{
  landingRequests: number;
  landingP95Milliseconds: number;
  stormFast429s: number;
}>;

export function runPublicDemoSpikeTest(
  environment?: PublicDemoSpikeTestEnvironment,
  fetchImplementation?: typeof fetch
): Promise<PublicDemoSpikeTestResult>;

export function safePublicDemoSpikeFailure(error: unknown): string;
