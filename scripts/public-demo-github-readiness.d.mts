export type PublicDemoGithubReadinessEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function validatePublicDemoGithubReadiness(
  environment?: PublicDemoGithubReadinessEnvironment,
  fetchImplementation?: typeof fetch
): Promise<Readonly<{ runId: number; runAttempt: number; gate: "success" }>>;
