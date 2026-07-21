# Hosted AI provider operations

This runbook is the production gate for the external-AI portion of the isolated household pilot. It does not authorize real family data by itself; the hosted beta contract, participant documents, deployment, recovery, and deletion gates still apply.

## Fixed pilot configuration

- Provider: OpenAI API in a dedicated Kin Resolve project, not the default project.
- Endpoint: `https://api.openai.com/v1/responses`.
- Model: `gpt-5-mini`.
- Application state: every request sets `store: false`.
- Initiation: owner/admin only, one non-sensitive research case at a time, with a fresh confirmation cleared whenever the question or case changes.
- Application quota: a durable per-archive-user ceiling of 12 provider attempts per rolling hour and 40 per rolling day.
- Server projection: exact allowlisted fields only. No unlinked, living, unknown, or sensitive person records; DNA; case decisions or task outcomes; notes; transcripts; sensitive facts; or files.

OpenAI documents that API inputs and outputs are not used for training unless the customer opts in. Under the default data-controls contract, abuse-monitoring logs may contain customer content for up to 30 days. `store: false` prevents Responses application-state storage, but it does not remove default abuse-monitoring retention. Zero Data Retention or Modified Abuse Monitoring requires separate OpenAI approval. See [OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint) and [OpenAI business data commitments](https://openai.com/business-data/).

## Account setup owned by the product owner

1. Create a dedicated OpenAI API project named for the Kin Resolve household pilot.
2. Keep provider data sharing and model-improvement opt-in disabled for the organization and project.
3. Restrict project model usage to the model(s) admitted by the release contract.
4. Configure the smallest practical prepaid balance. Disable automatic recharge unless explicitly approved.
5. Configure project budget alerts below and at the approved pilot budget. OpenAI project budgets are monitoring thresholds, not hard spending caps; requests continue after the threshold, so alerts do not replace the application quota and operator response.
6. Create a project-scoped service-account key. Put it directly into the Vercel Sensitive `AI_API_KEY` field for staging and production; never paste it into chat, tickets, source, build logs, or evidence artifacts.
7. Record non-secret evidence: project name/id, data-sharing setting, allowed models, budget/alerts, key creation date, key owner, and planned rotation date. Do not record the key value or a recoverable prefix.

## Release proof

- [ ] Counsel-approved privacy notice names OpenAI and accurately states the sent fields, purpose, choice, default retention, training posture, and research-aid limitation.
- [ ] Staging release validation confirms the exact endpoint, mode, model, and presence of a Sensitive provider key without revealing it.
- [ ] A synthetic browser canary proves the Run button is disabled before confirmation, the provider completes after confirmation, the privacy-boundary preview is recorded, and confirmation resets afterward.
- [ ] Provider request inspection proves `store: false` and no disallowed fixture markers are transmitted.
- [ ] The durable 12/hour and 40/day application limits are exercised with synthetic data; provider budget-alert delivery to the operator is verified.
- [ ] Key revocation is rehearsed: revoke the staging key, confirm deterministic fallback and sanitized errors, then issue a replacement.
- [ ] Production receives a separate key from staging and passes the same synthetic canary before any real GEDCOM upload.

## Incident and offboarding

- Disable `KINRESOLVE_EXTERNAL_AI_ENABLED` first to stop new external calls while preserving deterministic checks.
- Revoke the affected project key, rotate Vercel secrets, and redeploy before re-enabling.
- Use Kin Resolve run metadata (`requestedBy`, consent policy version, provider, model, and timestamps) for audit. Do not copy prompts or family content into incident channels.
- At pilot end, revoke both keys, archive the provider project after final usage review, and follow the participant notice for any Kin Resolve data that remains in the isolated cell or backups.
