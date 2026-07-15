#!/usr/bin/env node
import {
  loadReleasePolicy,
  validateFirstCutoverAcknowledgement
} from "../lib/release-policy.ts";

try {
  const policy = await loadReleasePolicy({ repositoryRoot: process.cwd() });
  const acknowledgement = validateFirstCutoverAcknowledgement({
    policy,
    owner: process.env.RELEASE_POLICY_OWNER,
    acknowledgedAt: process.env.RELEASE_POLICY_ACKNOWLEDGED_AT,
    acknowledgement: process.env.FIRST_CUTOVER_ACKNOWLEDGEMENT
  });
  console.log(
    `Verified ${policy.migrations.length} migrations for baseline ${policy.baseline.tag} ` +
      `with ${policy.rollbackPolicy} rollback policy; owner ${acknowledgement.owner}, ` +
      `acknowledged ${acknowledgement.acknowledgedAt}.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release policy validation failed.");
  process.exitCode = 1;
}
