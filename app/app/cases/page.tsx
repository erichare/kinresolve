import { AppShell } from "@/components/app-shell";
import { CaseWorkspace } from "@/components/case-workspace";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const workspace = await readWorkspace();

  return (
    <AppShell title="Cases" active="/app/cases">
      <CaseWorkspace initialCases={workspace.cases} />
    </AppShell>
  );
}
