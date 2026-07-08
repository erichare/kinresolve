import { AppShell } from "@/components/app-shell";
import { Status } from "@/components/ui";
import { WorkspaceSnapshotPanel } from "@/components/workspace-snapshot-panel";

export default function SettingsPage() {
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
              <input defaultValue="https://api.openai.com/v1" />
            </div>
            <div className="field">
              <label>Chat model</label>
              <input defaultValue="gpt-5-mini" />
            </div>
            <div className="field">
              <label>Embedding model</label>
              <input defaultValue="text-embedding-3-small" />
            </div>
            <Status tone="warning">API key stored server-side only</Status>
          </div>
        </aside>
      </div>

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
      <WorkspaceSnapshotPanel />
    </AppShell>
  );
}
