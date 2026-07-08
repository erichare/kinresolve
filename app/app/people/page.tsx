import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Confidence, Status } from "@/components/ui";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function AppPeoplePage() {
  const workspace = await readWorkspace();

  return (
    <AppShell title="People" active="/app/people">
      <div className="app-card">
        <h2>Imported and curated people</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Birth</th>
              <th>Death</th>
              <th>Privacy</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {workspace.people.map((person) => (
              <tr key={person.id}>
                <td>
                  <Link href={`/app/people/${person.id}`}>{person.displayName}</Link>
                </td>
                <td>{person.birthDate} · {person.birthPlace}</td>
                <td>{person.deathDate} · {person.deathPlace}</td>
                <td>
                  <Status tone={person.published ? "ok" : "private"}>{person.published ? "published" : "private"}</Status>
                </td>
                <td>
                  <Confidence value={0.78} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
