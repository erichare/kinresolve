import Link from "next/link";
import { PublicShell } from "@/components/public-shell";

export default function SetupPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="page-title section">
          <h1>First-run setup</h1>
          <p>Create the owner account, name the archive, import a GEDCOM, configure privacy defaults, and connect an OpenAI-compatible AI provider.</p>
        </section>
        <section className="grid-2">
          <div className="panel">
            <h2>Archive basics</h2>
            <div className="form-grid">
              <div className="field">
                <label>Archive name</label>
                <input defaultValue="Riemer - Zajicek Archive" />
              </div>
              <div className="field">
                <label>Accent color</label>
                <input defaultValue="#00634f" />
              </div>
              <div className="field">
                <label>Owner email</label>
                <input defaultValue="owner@example.com" />
              </div>
              <div className="field">
                <label>Living-person rule</label>
                <select defaultValue="conservative-100">
                  <option value="conservative-100">Conservative 100 year rule</option>
                </select>
              </div>
            </div>
          </div>
          <div className="panel">
            <h2>Import and AI</h2>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="field">
                <label>GEDCOM file</label>
                <input type="file" />
              </div>
              <div className="field">
                <label>AI base URL</label>
                <input defaultValue="https://api.openai.com/v1" />
              </div>
              <div className="field">
                <label>Chat model</label>
                <input defaultValue="gpt-5-mini" />
              </div>
            </div>
            <div className="hero-actions">
              <Link className="button" href="/app/imports">
                Continue to imports
              </Link>
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}

