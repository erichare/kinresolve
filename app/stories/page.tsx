import { PublicShell } from "@/components/public-shell";

export default function StoriesPage() {
  return (
    <PublicShell active="/stories">
      <div className="page-wrap">
        <section className="page-title section">
          <h1>Published Stories</h1>
          <p>Story pages are curated from private evidence and research cases. V0.1 includes the publishing surface and keeps unresolved investigations private.</p>
        </section>
        <section className="grid-3">
          {[
            "From Limerick to Chicago",
            "Cornwall clues in the Zajicek line",
            "Reading census neighborhoods as evidence"
          ].map((story) => (
            <article className="panel" key={story}>
              <h2>{story}</h2>
              <p>Synthetic story preview for the open-source demo archive.</p>
              <span className="tag">Curated</span>
            </article>
          ))}
        </section>
      </div>
    </PublicShell>
  );
}

