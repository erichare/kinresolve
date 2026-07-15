export type BetaApplicationMode = "application" | "mailto";

export function parseBetaApplicationMode(value: string | undefined): BetaApplicationMode {
  if (value === undefined || value === "mailto") return "mailto";
  if (value === "application") return "application";
  throw new Error("KINRESOLVE_MARKETING_BETA_APPLICATION_MODE must be exactly application or mailto.");
}

export const betaApplicationMode = parseBetaApplicationMode(
  process.env.KINRESOLVE_MARKETING_BETA_APPLICATION_MODE
);
