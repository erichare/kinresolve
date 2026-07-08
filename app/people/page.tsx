import Link from "next/link";
import { PublicShell } from "@/components/public-shell";
import { Confidence, Status } from "@/components/ui";
import { canPublishPerson } from "@/lib/privacy";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const workspace = await readWorkspace();
  const publishedPeople = workspace.people.filter((person) => person.published && canPublishPerson(person));

  return (
    <PublicShell active="/people">
      <div className="page-wrap">
        <section className="page-title section">
          <h1>Published People</h1>
          <p>Only manually published profiles are visible here. Private imported records, living people, DNA matches, and investigations stay in the workspace.</p>
        </section>
        <section className="table-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Birth</th>
                <th>Death</th>
                <th>Confidence</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {publishedPeople.map((person) => (
                <tr key={person.id}>
                  <td>
                    <Link href={`/people/${person.slug}`}>{person.displayName}</Link>
                  </td>
                  <td>{person.birthDate} · {person.birthPlace}</td>
                  <td>{person.deathDate} · {person.deathPlace}</td>
                  <td>
                    <Confidence value={0.86} />
                  </td>
                  <td>
                    <Status>Published</Status>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </PublicShell>
  );
}
