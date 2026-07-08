"use client";

import { useEffect, useState } from "react";
import type { ImportDiff, ImportSnapshot } from "@/lib/gedcom/importer";
import { workspaceStorageKeys, type StoredImportPreview } from "@/lib/workspace-snapshot";
import { Status } from "./ui";

type ImportResponse = {
  snapshot: Pick<ImportSnapshot, "id" | "sourceName" | "checksum" | "summary"> & { recordCount: number };
  diff?: ImportDiff;
  applied?: {
    import: {
      id: string;
      backupId: string;
      peopleImported: number;
      sourcesImported: number;
      rawRecordCount: number;
    };
    backup: {
      id: string;
      storageKey: string;
      peopleCount: number;
      sourcesCount: number;
    };
  };
};

export function ImportPreviewWorkspace() {
  const [sourceName, setSourceName] = useState("Riemer-Zajicek.ged");
  const [currentContent, setCurrentContent] = useState("");
  const [previousContent, setPreviousContent] = useState("");
  const [result, setResult] = useState<ImportResponse | undefined>();
  const [recentPreviews, setRecentPreviews] = useState<StoredImportPreview[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "applying" | "error">("idle");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = readLocalJson<StoredImportPreview[]>(workspaceStorageKeys.importPreviews);
      if (stored?.length) {
        setRecentPreviews(stored);
      }
      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(workspaceStorageKeys.importPreviews, JSON.stringify(recentPreviews));
  }, [hydrated, recentPreviews]);

  async function readFile(file: File | undefined, setter: (content: string) => void) {
    if (!file) {
      return;
    }

    setSourceName(file.name);
    setter(await file.text());
  }

  async function previewImport() {
    setStatus("loading");
    setError("");
    setResult(undefined);

    const response = await fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceName,
        content: currentContent,
        previousContent: previousContent || undefined
      })
    });

    if (!response.ok) {
      setStatus("error");
      setError(await response.text());
      return;
    }

    const nextResult = (await response.json()) as ImportResponse;
    setResult(nextResult);
    setRecentPreviews((current) => [
      {
        id: nextResult.snapshot.id,
        sourceName: nextResult.snapshot.sourceName,
        checksum: nextResult.snapshot.checksum,
        importedAt: new Date().toISOString(),
        recordCount: nextResult.snapshot.recordCount,
        summary: nextResult.snapshot.summary
      },
      ...current.filter((preview) => preview.id !== nextResult.snapshot.id)
    ].slice(0, 8));
    setStatus("idle");
  }

  async function applyImport() {
    if (!result || !currentContent) {
      return;
    }

    setStatus("applying");
    setError("");

    const response = await fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceName,
        content: currentContent,
        previousContent: previousContent || undefined,
        apply: true
      })
    });

    if (!response.ok) {
      setStatus("error");
      setError(await response.text());
      return;
    }

    setResult((await response.json()) as ImportResponse);
    setStatus("idle");
  }

  return (
    <div className="app-grid">
      <div className="app-card">
        <h2>Preview GEDCOM import</h2>
        <p className="muted">Preview a GEDCOM, preserve raw records, and apply it to the private workspace with a backup before changes are saved.</p>
        <div className="form-grid">
          <div className="field">
            <label>New GEDCOM</label>
            <input accept=".ged,.gedcom,text/plain" type="file" onChange={(event) => readFile(event.target.files?.[0], setCurrentContent)} />
          </div>
          <div className="field">
            <label>Previous GEDCOM for diff</label>
            <input accept=".ged,.gedcom,text/plain" type="file" onChange={(event) => readFile(event.target.files?.[0], setPreviousContent)} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Source name</label>
            <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
          </div>
        </div>
        <div className="hero-actions">
          <button className="button" disabled={status === "loading" || currentContent.length === 0} onClick={previewImport}>
            {status === "loading" ? "Parsing..." : "Preview import"}
          </button>
          {currentContent ? <Status>{currentContent.length.toLocaleString()} characters loaded</Status> : <Status tone="private">No file loaded</Status>}
        </div>
        {status === "error" ? <p className="muted">{error}</p> : null}
      </div>

      <aside className="app-card">
        <h2>Import result</h2>
        {result ? (
          <div className="evidence-list">
            <div className="evidence-item">
              <strong>{result.snapshot.sourceName}</strong>
              <p className="muted">Checksum {result.snapshot.checksum}</p>
              <div className="grid-3">
                <MiniStat label="People" value={result.snapshot.summary.individuals} />
                <MiniStat label="Families" value={result.snapshot.summary.families} />
                <MiniStat label="Sources" value={result.snapshot.summary.sources} />
              </div>
            </div>
            <div className="evidence-item">
              <strong>Preserved raw data</strong>
              <p className="muted">
                {result.snapshot.summary.sourceReferences.toLocaleString()} source refs · {result.snapshot.summary.urls.toLocaleString()} URLs · {result.snapshot.summary.ancestryApids.toLocaleString()} Ancestry IDs · {result.snapshot.summary.notes.toLocaleString()} notes
              </p>
            </div>
            <button className="button" disabled={status === "applying"} onClick={applyImport}>
              {status === "applying" ? "Applying..." : "Apply import"}
            </button>
            {result.applied ? (
              <div className="evidence-item">
                <strong>Applied to workspace</strong>
                <p className="muted">
                  {result.applied.import.peopleImported.toLocaleString()} people · {result.applied.import.sourcesImported.toLocaleString()} sources · {result.applied.import.rawRecordCount.toLocaleString()} raw records
                </p>
                <p className="muted">Backup {result.applied.backup.id} saved to {result.applied.backup.storageKey}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">Load a GEDCOM file to preview preserved records, dates, sources, media, notes, and re-import changes.</p>
        )}
      </aside>

      {result?.diff ? (
        <section className="app-card" style={{ gridColumn: "1 / -1" }}>
          <h2>Re-import diff</h2>
          <div className="metric-row">
            <MiniMetric label="Added" value={result.diff.added} />
            <MiniMetric label="Changed" value={result.diff.changed} />
            <MiniMetric label="Deleted" value={result.diff.deleted} />
            <MiniMetric label="Unchanged" value={result.diff.unchanged} />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Xref</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {result.diff.records.slice(0, 12).map((record, index) => (
                <tr key={`${record.xref ?? "no-xref"}-${record.type}-${index}`}>
                  <td>
                    <Status tone={record.status === "changed" || record.status === "deleted" ? "warning" : "ok"}>{record.status}</Status>
                  </td>
                  <td>{record.xref ?? "no xref"}</td>
                  <td>{record.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {recentPreviews.length > 0 ? (
        <section className="app-card" style={{ gridColumn: "1 / -1" }}>
          <h2>Recent local previews</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Previewed</th>
                <th>People</th>
                <th>Families</th>
                <th>Raw records</th>
              </tr>
            </thead>
            <tbody>
              {recentPreviews.map((preview) => (
                <tr key={preview.id}>
                  <td>{preview.sourceName}</td>
                  <td>{new Date(preview.importedAt).toLocaleString()}</td>
                  <td>{preview.summary.individuals.toLocaleString()}</td>
                  <td>{preview.summary.families.toLocaleString()}</td>
                  <td>{preview.recordCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function readLocalJson<T>(key: string): T | undefined {
  const value = window.localStorage.getItem(key);
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value.toLocaleString()}</strong>
      <div className="muted">{label}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}
