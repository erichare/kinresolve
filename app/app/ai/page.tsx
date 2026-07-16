import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AIAnalystWorkspace } from "@/components/ai-analyst-workspace";
import { findStructuredAnomalies } from "@/lib/ai";
import { getSessionContext, workspaceOptionsForSession } from "@/lib/auth-session";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { createWorkspaceDnaHypotheses, readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const initialQuestion = "Could Samuel Mercer and Samuel March be the same person, and which fictional Hartwell–Mercer record should be checked next?";

export default async function AIPage() {
  const capabilities = resolveHostedCapabilities();
  const session = await getSessionContext(await headers());
  if (!session || session.kind === "demo-guest") notFound();
  const workspace = await readWorkspace(workspaceOptionsForSession(session));
  const dnaHypotheses = capabilities.dna ? createWorkspaceDnaHypotheses(workspace) : [];
  const anomalies = findStructuredAnomalies(workspace.people);

  return (
    <AppShell title="AI Analyst" active="/app/ai" archiveName={workspace.archiveName}>
      <p className="fiction-disclosure" role="note">
        <strong>Built-in prompt only:</strong> the Hartwell–Mercer names, places, dates, records, and photograph are entirely fictional. Your own workspace content is not demo data.
      </p>
      <AIAnalystWorkspace
        initialQuestion={initialQuestion}
        cases={workspace.cases}
        initialRuns={workspace.aiRuns}
        anomalies={anomalies}
        counts={{
          people: workspace.people.length,
          cases: workspace.cases.length,
          dnaHypotheses: dnaHypotheses.length
        }}
        dnaHypotheses={dnaHypotheses}
        dnaEnabled={capabilities.dna}
        externalAiEnabled={capabilities.externalAi}
      />
    </AppShell>
  );
}
