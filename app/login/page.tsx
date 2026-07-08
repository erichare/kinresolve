import Link from "next/link";
import { PublicShell } from "@/components/public-shell";

export default function LoginPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="section" style={{ maxWidth: 520, margin: "40px auto" }}>
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Private workspace</h1>
            <p className="muted">Authentication scaffolding is ready for the owner/admin/editor/contributor/viewer model. The demo workspace opens directly in V0.1 development mode.</p>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="field">
                <label>Email</label>
                <input defaultValue="owner@example.com" />
              </div>
              <div className="field">
                <label>Password</label>
                <input type="password" defaultValue="kinsleuth" />
              </div>
            </div>
            <div className="hero-actions">
              <Link className="button" href="/app">
                Open workspace
              </Link>
              <Link className="button-secondary" href="/setup">
                First-run setup
              </Link>
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}

