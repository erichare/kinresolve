import { Icons } from "@/components/icons";
import { redirect } from "next/navigation";
import { PublicShell } from "@/components/public-shell";
import { EmptyState } from "@/components/ui";
import { privateWorkspaceLoginPath, publicArchiveEnabled, resolvePublicArchiveId } from "@/lib/public-surface";
import { listPublicPlaces, readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  if (!publicArchiveEnabled()) {
    redirect(privateWorkspaceLoginPath);
  }
  const publicArchiveId = resolvePublicArchiveId();
  const archiveOptions = { archiveId: publicArchiveId };
  const [branding, places] = await Promise.all([
    readArchiveBranding(archiveOptions),
    listPublicPlaces(archiveOptions)
  ]);

  return (
    <PublicShell active="/places" tagline={branding.tagline}>
      <div className="page-wrap">
        <section className="page-title section">
          <h1>Published Places</h1>
          <p>Place indexes show curated public references only. Normalization and historical-place work continue inside the private workspace.</p>
        </section>
        <section className="place-grid">
          {places.map((place) => (
            <article className="place-card" key={place.name}>
              <span className="place-card-mark" aria-hidden><Icons.MapPin size={22} /></span>
              <div>
                <span className="card-kicker">Published place</span>
                <h2>{place.name}</h2>
                <p>{place.personNames.slice(0, 3).join(", ")}</p>
                <div className="place-card-meta">
                  <span>{place.referenceCount} public {place.referenceCount === 1 ? "reference" : "references"}</span>
                  <span>{place.personNames.length} connected {place.personNames.length === 1 ? "profile" : "profiles"}</span>
                </div>
              </div>
            </article>
          ))}
        </section>
        {places.length === 0 ? (
          <EmptyState icon={<Icons.MapPin size={22} aria-hidden />} title="No published places yet">
            Places appear here after public facts are selected on a published profile.
          </EmptyState>
        ) : null}
      </div>
    </PublicShell>
  );
}
