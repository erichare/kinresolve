export type MarketingReleaseMode = "prelaunch" | "application" | "api-launch";

export function parseMarketingReleaseMode(value: string | undefined): MarketingReleaseMode {
  if (value === undefined || value === "prelaunch") return "prelaunch";
  if (value === "application" || value === "api-launch") return value;
  throw new Error(
    "KINRESOLVE_MARKETING_RELEASE_MODE must be exactly prelaunch, application, or api-launch."
  );
}

export const marketingReleaseMode = parseMarketingReleaseMode(
  process.env.KINRESOLVE_MARKETING_RELEASE_MODE
);
