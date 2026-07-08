import { AppShell } from "@/components/app-shell";
import { CaseWorkspace } from "@/components/case-workspace";
import { demoCases } from "@/lib/demo-data";

export default function CasesPage() {
  return (
    <AppShell title="Cases" active="/app/cases">
      <CaseWorkspace initialCases={demoCases} />
    </AppShell>
  );
}
