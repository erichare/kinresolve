import { AppShell } from "@/components/app-shell";
import { Status } from "@/components/ui";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const runtime = await getRuntimeStatus();

  return (
    <AppShell title="Settings" active="/app/settings">
      <div className="app-grid">
        <div className="app-card">
          <h2>Archive branding</h2>
          <div className="form-grid">
            <div className="field">
              <label>Archive name</label>
              <input defaultValue="Riemer - Zajicek Archive" />
            </div>
            <div className="field">
              <label>Tagline</label>
              <input defaultValue="A free and open archive of curated family history." />
            </div>
            <div className="field">
              <label>Accent color</label>
              <input defaultValue="#00634f" />
            </div>
            <div className="field">
              <label>Public root</label>
              <input defaultValue="/" />
            </div>
          </div>
        </div>
        <aside className="app-card">
          <h2>AI provider</h2>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <div className="field">
              <label>Base URL</label>
              <input readOnly value={runtime.ai.baseUrl} />
            </div>
            <div className="field">
              <label>Chat model</label>
              <input readOnly value={runtime.ai.chatModel} />
            </div>
            <div className="field">
              <label>Embedding model</label>
              <input readOnly value={runtime.ai.embeddingModel} />
            </div>
            <div className="field">
              <label>API mode</label>
              <input readOnly value={runtime.ai.mode} />
            </div>
            <Status tone={runtime.ai.configured ? "ok" : "warning"}>{runtime.ai.configured ? "Provider key configured" : "API key stored server-side only"}</Status>
          </div>
        </aside>
      </div>

      <section className="app-card" style={{ marginTop: 20 }}>
        <div className="app-card-header">
          <div>
            <h2>Runtime storage</h2>
            <p className="muted">Postgres is the active workspace store for people, sources, DNA, cases, imports, tasks, and AI runs.</p>
          </div>
          <Status tone={runtime.database.connected ? "ok" : "warning"}>{runtime.database.connected ? "Postgres connected" : "Database unavailable"}</Status>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Database</label>
            <input readOnly value={runtime.database.configured ? "Configured in DATABASE_URL" : "Missing DATABASE_URL"} />
          </div>
          <div className="field">
            <label>Archive id</label>
            <input readOnly value={runtime.database.archiveId} />
          </div>
          <div className="field">
            <label>People</label>
            <input readOnly value={runtime.database.peopleCount.toLocaleString()} />
          </div>
          <div className="field">
            <label>Cases</label>
            <input readOnly value={runtime.database.caseCount.toLocaleString()} />
          </div>
          <div className="field">
            <label>AI runs</label>
            <input readOnly value={runtime.database.aiRunCount.toLocaleString()} />
          </div>
        </div>
        {runtime.database.error ? <p className="form-error">{runtime.database.error}</p> : null}
      </section>

      <section className="app-card" style={{ marginTop: 20 }}>
        <h2>Roles</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Purpose</th>
              <th>Whole-tree AI</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Owner</td>
              <td>Controls system settings, imports, users, publishing, and AI.</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Admin</td>
              <td>Manages users, imports, publishing, and research operations.</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Editor</td>
              <td>Edits people, cases, evidence, DNA matches, and public stories.</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Contributor</td>
              <td>Adds evidence, tasks, notes, and research observations.</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Viewer</td>
              <td>Reads approved private content.</td>
              <td>No</td>
            </tr>
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
