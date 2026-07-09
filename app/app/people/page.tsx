import { AppShell } from "@/components/app-shell";
import { PeopleWorkspace } from "@/components/people-workspace";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function AppPeoplePage() {
  const workspace = await readWorkspace();

  return (
    <AppShell title="People" active="/app/people">
      <PeopleWorkspace people={workspace.people} />
    </AppShell>
  );
}
