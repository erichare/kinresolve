import { AppShell } from "@/components/app-shell";
import { DnaTriageWorkspace } from "@/components/dna-triage-workspace";
import { demoDnaHypotheses, scoredDnaMatches } from "@/lib/demo-data";

export default function DnaPage() {
  return (
    <AppShell title="DNA Match Triage" active="/app/dna">
      <DnaTriageWorkspace initialMatches={scoredDnaMatches} initialHypothesis={demoDnaHypotheses[0]} />
    </AppShell>
  );
}
