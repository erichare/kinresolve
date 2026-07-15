import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

function sourceCommit(): string {
  const explicitCommit = process.env.KINRESOLVE_MARKETING_SOURCE_COMMIT_SHA?.trim();
  const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const githubCommit = process.env.GITHUB_SHA?.trim();
  let checkedOutCommit: string | undefined;
  try {
    checkedOutCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    // Vercel or the release workflow must supply one of the environment candidates.
  }
  const environmentCandidates = explicitCommit
    ? [explicitCommit, ...(vercelCommit ? [vercelCommit] : [])]
    : vercelCommit
      ? [vercelCommit]
      : githubCommit
        ? [githubCommit]
        : [];
  const candidates = [...environmentCandidates, ...(checkedOutCommit ? [checkedOutCommit] : [])];
  if (candidates.length === 0 || candidates.some((candidate) => !/^[a-f0-9]{40}$/.test(candidate))) {
    throw new Error("The marketing build requires one full lowercase source commit SHA.");
  }
  if (new Set(candidates).size !== 1) {
    throw new Error("The marketing build source commit does not match the checked-out revision.");
  }
  return candidates[0];
}

const nextConfig: NextConfig = {
  output: "export",
  turbopack: {
    root: process.cwd()
  },
  images: {
    unoptimized: true
  },
  env: {
    NEXT_PUBLIC_KINRESOLVE_SOURCE_COMMIT_SHA: sourceCommit()
  },
  trailingSlash: true,
  poweredByHeader: false
};

export default nextConfig;
