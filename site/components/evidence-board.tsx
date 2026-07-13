export function EvidenceBoard() {
  return (
    <div className="evidence-board" aria-label="Illustration of a research question connected to conflicting records, DNA evidence, and a working conclusion">
      <div className="board-toolbar">
        <span className="board-breadcrumb">Case 04 / Kelly maternal line</span>
        <span className="board-state"><i aria-hidden="true" /> In review</span>
      </div>
      <div className="question-card">
        <span className="card-label">Focused question</span>
        <strong>Where was Nora Kelly born?</strong>
        <p>Resolve the conflict before linking the Chicago record.</p>
      </div>
      <div className="evidence-row">
        <article className="record-card record-conflict">
          <span className="record-type">1901 census</span>
          <strong>County Clare</strong>
          <small>Self-reported · 1 source</small>
        </article>
        <span className="versus" aria-hidden="true">≠</span>
        <article className="record-card">
          <span className="record-type">Parish register</span>
          <strong>Limerick City</strong>
          <small>Primary image · 2 citations</small>
        </article>
      </div>
      <div className="signal-card">
        <span className="signal-icon" aria-hidden="true">DNA</span>
        <div>
          <span className="card-label">Supporting clue</span>
          <strong>Two shared matches point to the Ryan branch.</strong>
        </div>
        <span className="signal-score">42 cM</span>
      </div>
      <div className="conclusion-card">
        <div>
          <span className="card-label">Working conclusion</span>
          <strong>Limerick is better supported—for now.</strong>
        </div>
        <span className="confidence">Moderate confidence</span>
      </div>
      <div className="board-note">Every conclusion keeps its evidence and uncertainty in view.</div>
    </div>
  );
}
