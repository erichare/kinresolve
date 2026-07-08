import Link from "next/link";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { Status } from "@/components/ui";
import { archiveStats, demoPeople } from "@/lib/demo-data";

export default function HomePage() {
  const publishedPeople = demoPeople.filter((person) => person.published);

  return (
    <PublicShell active="/">
      <div className="page-wrap">
        <section className="hero">
          <div>
            <h1>Riemer - Zajicek Archive</h1>
            <p>A curated family-history archive for published ancestor profiles, places, stories, and selected citations. Private research, DNA triage, and living-person details stay protected.</p>
            <div className="hero-actions">
              <Link className="button" href="/people">
                <Icons.Users size={17} aria-hidden />
                Explore People
              </Link>
              <Link className="button-secondary" href="/stories">
                <Icons.BookOpen size={17} aria-hidden />
                Browse Stories
              </Link>
            </div>
          </div>
          <div className="map-panel" aria-label="Migration map preview">
            <div className="map-line" />
            <span className="map-pin">
              <Icons.MapPin size={15} aria-hidden />
              Limerick
            </span>
            <span className="map-pin">
              <Icons.MapPin size={15} aria-hidden />
              Cornwall
            </span>
            <span className="map-pin">
              <Icons.MapPin size={15} aria-hidden />
              Chicago
            </span>
          </div>
        </section>

        <section className="section grid-2">
          <div className="table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Title</th>
                  <th>Date</th>
                  <th>Visibility</th>
                </tr>
              </thead>
              <tbody>
                {publishedPeople.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <Icons.Users size={16} aria-hidden />
                    </td>
                    <td>
                      <Link href={`/people/${person.slug}`}>{person.displayName}</Link>
                    </td>
                    <td>{person.birthDate}</td>
                    <td>
                      <Status>Published</Status>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <Icons.MapPin size={16} aria-hidden />
                  </td>
                  <td>Chicago / Limerick / Cornwall migration path</td>
                  <td>1880-1910</td>
                  <td>
                    <Status>Published</Status>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Icons.Shield size={16} aria-hidden />
                  </td>
                  <td>Private investigations and DNA matches</td>
                  <td>Protected</td>
                  <td>
                    <Status tone="private">Private</Status>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <aside className="panel">
            <h2>About this archive</h2>
            <p>This public archive is manually curated from a larger private research database. KinSleuth keeps imported records, source analysis, AI runs, and DNA matches behind role-based access controls.</p>
            <div className="grid-3" style={{ marginTop: 18 }}>
              <div>
                <strong>{archiveStats.people.toLocaleString()}</strong>
                <div className="muted">people imported</div>
              </div>
              <div>
                <strong>{archiveStats.sources.toLocaleString()}</strong>
                <div className="muted">sources</div>
              </div>
              <div>
                <strong>{archiveStats.citations.toLocaleString()}</strong>
                <div className="muted">citations</div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </PublicShell>
  );
}

