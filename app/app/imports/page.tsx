import { AppShell } from "@/components/app-shell";
import { ImportPreviewWorkspace } from "@/components/import-preview-workspace";
import { Status } from "@/components/ui";

const imports = [
  { file: "Riemer-Zajicek.ged", imported: "May 10, 2025 10:32 AM", status: "complete", records: "12,842" },
  { file: "Cousins-2024.ged", imported: "Apr 28, 2025 2:15 PM", status: "complete", records: "8,731" },
  { file: "LegacyExport.ged", imported: "Apr 12, 2025 9:41 AM", status: "partial", records: "5,113" }
];

export default function ImportsPage() {
  return (
    <AppShell title="GEDCOM Imports" active="/app/imports">
      <div className="app-grid">
        <div className="app-card">
          <h2>Import snapshots</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Imported</th>
                <th>Status</th>
                <th>Records</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((item) => (
                <tr key={item.file}>
                  <td>{item.file}</td>
                  <td>{item.imported}</td>
                  <td>
                    <Status tone={item.status === "partial" ? "warning" : "ok"}>{item.status}</Status>
                  </td>
                  <td>{item.records}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="app-card">
          <h2>Import policy</h2>
          <p className="muted">
            KinSleuth previews every GEDCOM before applying it. New imports preserve raw records and later re-imports produce a reviewable diff so curated research is not overwritten silently.
          </p>
          <div className="evidence-list">
            <div className="evidence-item">
              <strong>Private by default</strong>
              <p className="muted">Imported facts, living people, DNA notes, and case evidence stay private until explicitly curated.</p>
            </div>
            <div className="evidence-item">
              <strong>Traceable by design</strong>
              <p className="muted">Raw xrefs, Ancestry IDs, URLs, citations, notes, and media pointers remain attached to imported records.</p>
            </div>
          </div>
        </aside>
      </div>

      <section className="app-card" style={{ marginTop: 20, marginBottom: 20 }}>
        <h2>Diff review</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Record</th>
              <th>Type</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Status>Added</Status>
              </td>
              <td>@I20437801951@</td>
              <td>INDI</td>
              <td>New source citation and event note preserved from Ancestry export.</td>
            </tr>
            <tr>
              <td>
                <Status tone="warning">Changed</Status>
              </td>
              <td>@F2545@</td>
              <td>FAM</td>
              <td>Relationship xref changed; curated overlay requires review.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <ImportPreviewWorkspace />
    </AppShell>
  );
}
