import { AppShell } from "@/components/app-shell";
import { Metric, Status } from "@/components/ui";
import { demoCases, demoDnaMatches, demoPeople } from "@/lib/demo-data";
import { buildQualityReport } from "@/lib/quality";

export default function ReportsPage() {
  const report = buildQualityReport(demoPeople, demoDnaMatches, demoCases);

  return (
    <AppShell title="Quality Reports" active="/app/reports">
      <div className="metric-row">
        <Metric label="Archive quality" value={`${report.score}%`} detail="demo score" />
        <Metric label="High severity" value={report.summary.high} detail="fix before publishing" />
        <Metric label="Source gaps" value={report.summary.sourceGaps} detail="vital facts" />
        <Metric label="DNA gaps" value={report.summary.dnaGaps} detail="triage blockers" />
      </div>

      <section className="app-card">
        <h2>Prioritized review queue</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Area</th>
              <th>Issue</th>
              <th>Recommended action</th>
            </tr>
          </thead>
          <tbody>
            {report.issues.map((issue) => (
              <tr key={issue.id}>
                <td>
                  <Status tone={issue.severity === "high" || issue.severity === "medium" ? "warning" : "private"}>{issue.severity}</Status>
                </td>
                <td>{issue.area}</td>
                <td>
                  <strong>{issue.title}</strong>
                  <div className="muted">{issue.detail}</div>
                </td>
                <td>{issue.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}

