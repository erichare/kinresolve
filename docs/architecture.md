# KinSleuth architecture

KinSleuth separates three layers of genealogy data:

1. **Raw imports** preserve every GEDCOM record, custom tag, source reference, URL, media pointer, and import snapshot.
2. **Normalized research data** powers search, profiles, relationships, facts, sources, places, cases, DNA matches, and AI retrieval.
3. **Curated public content** is manually published and can safely omit living people, sensitive facts, private cases, and unreviewed evidence.

The V0.1 implementation is intentionally one-family-archive-per-deployment. That keeps privacy, branding, and permission decisions simple while leaving room for multi-archive hosting later.

## Runtime

- Next.js App Router renders public and private routes.
- Postgres stores normalized workspace data, import snapshots, backups, case tasks, and AI run history.
- `pgvector` is provisioned for semantic embeddings for source notes, facts, case evidence, and DNA match notes.
- Object storage stores uploaded source images, PDFs, and transcripts.
- A background worker owns GEDCOM imports, re-import diffs, embedding refreshes, and long AI jobs.

## Privacy

Anonymous visitors can only see manually published content. Private routes require authentication and role checks. Living people are conservatively inferred when no death fact exists and the birth date is within the last 100 years, or when dates are missing but recent relatives imply the person may be living.

## AI

AI is a provider abstraction, not a hard dependency. Structured checks run deterministically. Provider-backed analysis uses an OpenAI-compatible API when configured, sends full private workspace context, and stages suggestions for explicit user confirmation. Whole-tree AI is owner/admin only by default.
