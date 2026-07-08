import { AppShell } from "@/components/app-shell";
import { Confidence, Status } from "@/components/ui";
import { demoCases, demoDnaHypotheses, demoPeople } from "@/lib/demo-data";
import { findStructuredAnomalies } from "@/lib/ai";

export default function AIPage() {
  const anomalies = findStructuredAnomalies(demoPeople);

  return (
    <AppShell title="AI Analyst" active="/app/ai">
      <div className="app-grid">
        <div className="app-card">
          <h2>Whole-tree analysis</h2>
          <p className="muted">Owner/admin-only analysis combines deterministic checks with semantic retrieval over facts, notes, sources, cases, transcripts, and DNA match notes.</p>
          <div className="field">
            <label>Research question</label>
            <textarea defaultValue="Where is J. Fletcher most likely to connect to the Riemer maternal line, and which evidence should be checked next?" />
          </div>
          <div className="hero-actions">
            <button className="button">Run analysis</button>
            <Status tone="private">Owner/Admin only</Status>
          </div>

          <section className="section">
            <h2>Recent connection hypotheses</h2>
            <div className="evidence-list">
              {demoDnaHypotheses.map((hypothesis) => (
                <div className="hypothesis-panel" key={hypothesis.matchId}>
                  <strong>{hypothesis.likelyBranch}</strong>
                  <p>{hypothesis.explanation}</p>
                  <Confidence value={hypothesis.confidence} />
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="app-card">
          <h2>Structured checks</h2>
          <div className="evidence-list">
            {anomalies.length > 0 ? (
              anomalies.map((anomaly) => (
                <div className="evidence-item" key={anomaly.title}>
                  <strong>{anomaly.title}</strong>
                  <p className="muted">{anomaly.evidence.join(" · ")}</p>
                  <Status tone={anomaly.severity === "high" ? "warning" : "private"}>{anomaly.severity}</Status>
                </div>
              ))
            ) : (
              <div className="evidence-item">
                <strong>No high-risk anomalies in demo data</strong>
                <p className="muted">{demoPeople.length} people, {demoCases.length} cases, {demoDnaHypotheses.length} DNA hypotheses checked.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

