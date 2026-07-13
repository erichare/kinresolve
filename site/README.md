# Kin Resolve marketing site

This directory is a self-contained Next.js application for `kinresolve.com`. It has no imports from the product app, database, authentication, workspace storage, or family data.

## Local verification

```bash
npm ci
npm run verify
```

`verify` runs ESLint, TypeScript, a portable static export, and checks every exported route, internal link, asset, and required social/search file.

Use `npm run dev` for local development. The production repository also exposes `npm run site:dev` and `npm run site:verify` from the root.

## Deployment

The site is linked to the isolated Vercel project `kinresolve-marketing`; it does not share the product project or release workflow.

- Pull requests verify the portable static artifact but never receive deployment credentials.
- Preview and production deployments are manual, main-only runs of `.github/workflows/site-deploy.yml`; the workflow defaults to preview mode.
- The workflow uses `VERCEL_TOKEN` and `VERCEL_ORG_ID` secrets plus the `MARKETING_VERCEL_PROJECT_ID` repository variable.
- Cloudflare DNS is intentionally outside the workflow. Pointing `kinresolve.com` at Vercel requires explicit owner approval after preview and contact-route checks.

The beta form exposes the proposed email application and a copy fallback, but sending is deliberately disabled while `beta@kinresolve.com` has no verified route. Activate and test that mailbox, then flip `betaIntakeReady` in `lib/site.ts` before a public domain cutover. The marketing site does not store submissions.

## Content boundaries

Current capabilities and roadmap claims follow [`docs/brand-and-domain.md`](../docs/brand-and-domain.md). Keep product status labels explicit, use synthetic examples only, and do not add legal privacy or terms pages until counsel supplies them.
