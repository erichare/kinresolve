import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { Confidence, Metric, Status } from "@/components/ui";
import { archiveStats, demoCases, demoDnaHypotheses, scoredDnaMatches } from "@/lib/demo-data";

export default function AppDashboardPage() {
  return (
    <AppShell
      title="Investigation Dashboard"
      active="/app"
      actions={
        <div className="hero-actions" style={{ marginTop: 0 }}>
          <Link className="button" href="/app/cases">
            <Icons.FileSearch size={16} aria-hidden />
            New Case
          </Link>
          <Link className="button-secondary" href="/app/imports">
            <Icons.Upload size={16} aria-hidden />
            Import GEDCOM
          </Link>
        </div>
      }
    >
      <div className="metric-row">
        <Metric label="Imported people" value={archiveStats.people.toLocaleString()} detail="from private GEDCOM" />
        <Metric label="Source refs" value={archiveStats.citations.toLocaleString()} detail="preserved citations" />
        <Metric label="DNA matches" value={archiveStats.dnaMatches.toLocaleString()} detail={`${archiveStats.triagedMatches} triaged`} />
        <Metric label="High priority" value={archiveStats.highPriorityMatches} detail="DNA leads" />
      </div>

      <div className="app-grid">
        <div className="app-card">
          <h2>Cases</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Status</th>
                <th>Focus</th>
                <th>Evidence</th>
              </tr>
            </thead>
          <tbody>
            {demoCases.map((researchCase) => (
              <tr key={researchCase.id}>
                <td>
                  <Link href={`/app/cases/${researchCase.id}`}>{researchCase.title}</Link>
                  </td>
                  <td>
                    <Status tone={researchCase.status === "planning" ? "warning" : "ok"}>{researchCase.status}</Status>
                  </td>
                  <td>{researchCase.focus}</td>
                  <td>{researchCase.evidence.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="app-card">
          <h2>AI Analyst</h2>
          <div className="evidence-list">
            {demoDnaHypotheses.slice(0, 2).map((hypothesis) => (
              <div className="evidence-item" key={hypothesis.matchId}>
                <strong>{hypothesis.likelyBranch}</strong>
                <p className="muted">{hypothesis.explanation}</p>
                <Confidence value={hypothesis.confidence} />
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="app-card" style={{ marginTop: 20 }}>
        <h2>Recent DNA triage</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Match</th>
              <th>cM</th>
              <th>Side</th>
              <th>Tree</th>
              <th>Helpfulness</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {scoredDnaMatches.map((match) => (
              <tr key={match.id}>
                <td>
                  <Link href="/app/dna">{match.displayName}</Link>
                </td>
                <td>{match.totalCm}</td>
                <td>{match.side}</td>
                <td>{match.treeStatus}</td>
                <td>
                  <Confidence value={match.helpfulnessScore / 100} />
                </td>
                <td>
                  <Status tone={match.triageStatus === "high_priority" ? "warning" : "ok"}>{match.triageStatus.replace("_", " ")}</Status>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
