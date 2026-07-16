import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DnaTriageWorkspace } from "@/components/dna-triage-workspace";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { getSessionContext } from "@/lib/auth-session";
import { createDnaHypothesesForMatches, listCaseOptions, searchDnaMatchesPageFromDb } from "@/lib/store/dna-queries";
import { readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function DnaPage() {
  if (!resolveHostedCapabilities().dna) {
    notFound();
  }
  const session = await getSessionContext(await headers());
  if (!session) notFound();
  const archiveOptions = { archiveId: session.archiveId };

  const [branding, initialResult, initialCases] = await Promise.all([
    readArchiveBranding(archiveOptions),
    searchDnaMatchesPageFromDb({}, { page: 1, pageSize: 25 }, archiveOptions),
    listCaseOptions(archiveOptions)
  ]);
  const initialHypotheses = await createDnaHypothesesForMatches(initialResult.items, archiveOptions);

  return (
    <AppShell title="DNA Match Triage" active="/app/dna" archiveName={branding.name}>
      <DnaTriageWorkspace initialCases={initialCases} initialResult={initialResult} initialHypotheses={initialHypotheses} />
    </AppShell>
  );
}
