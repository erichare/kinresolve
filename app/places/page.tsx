import { PublicShell } from "@/components/public-shell";
import { canPublishPerson, publicFactFilter } from "@/lib/privacy";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const workspace = await readWorkspace();
  const places = Array.from(
    new Set(
      workspace.people
        .filter((person) => person.published && canPublishPerson(person))
        .flatMap((person) => person.facts.filter(publicFactFilter).map((fact) => fact.place).filter(Boolean) as string[])
    )
  );

  return (
    <PublicShell active="/places">
      <div className="page-wrap">
        <section className="page-title section">
          <h1>Published Places</h1>
          <p>Place indexes show curated public references only. Normalization and historical-place work continue inside the private workspace.</p>
        </section>
        <section className="grid-3">
          {places.map((place) => (
            <div className="panel" key={place}>
              <h2>{place}</h2>
              <p>Connected to published or candidate research paths in the Riemer - Zajicek archive.</p>
            </div>
          ))}
        </section>
      </div>
    </PublicShell>
  );
}
