"use client";

import { useEffect, useState } from "react";
import {
  createWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  snapshotCounts,
  workspaceStorageKeys,
  type StoredDnaMatch,
  type StoredImportPreview,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotCounts
} from "@/lib/workspace-snapshot";
import type { DnaConnectionHypothesis, ResearchCase } from "@/lib/models";
import { Status } from "./ui";

const emptyCounts: WorkspaceSnapshotCounts = {
  dnaMatches: 0,
  cases: 0,
  importPreviews: 0
};

export function WorkspaceSnapshotPanel() {
  const [counts, setCounts] = useState(emptyCounts);
  const [snapshotText, setSnapshotText] = useState("");
  const [message, setMessage] = useState("Workspace browser storage is ready.");

  function refreshCounts() {
    const snapshot = readSnapshotFromStorage();
    setCounts(snapshotCounts(snapshot));
  }

  useEffect(() => {
    const timeout = window.setTimeout(refreshCounts, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  function exportSnapshot() {
    const snapshot = createWorkspaceSnapshot(readSnapshotFromStorage());
    const text = JSON.stringify(snapshot, null, 2);
    setSnapshotText(text);
    setMessage(`Export ready: ${snapshot.dnaMatches.length} DNA matches, ${snapshot.cases.length} cases, ${snapshot.importPreviews.length} import previews.`);
  }

  function importSnapshot() {
    try {
      const snapshot = parseWorkspaceSnapshot(snapshotText);
      writeSnapshotToStorage(snapshot);
      setCounts(snapshotCounts(snapshot));
      setMessage(`Imported snapshot from ${new Date(snapshot.exportedAt).toLocaleString()}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Snapshot import failed.");
    }
  }

  function resetWorkspace() {
    for (const key of Object.values(workspaceStorageKeys)) {
      window.localStorage.removeItem(key);
    }
    setCounts(emptyCounts);
    setSnapshotText("");
    setMessage("Local workspace state reset.");
  }

  return (
    <section className="app-card" style={{ marginTop: 20 }}>
      <h2>Workspace snapshot</h2>
      <p className="muted">V0.3 stores demo workspace edits in this browser and lets you export or restore them as a portable JSON snapshot before the database-backed workspace lands.</p>
      <div className="metric-row">
        <MiniCount label="DNA matches" value={counts.dnaMatches} />
        <MiniCount label="Cases" value={counts.cases} />
        <MiniCount label="Import previews" value={counts.importPreviews} />
        <div className="metric">
          <span>Status</span>
          <strong style={{ fontSize: 18 }}>Local</strong>
          <span>browser storage</span>
        </div>
      </div>
      <div className="field">
        <label>Snapshot JSON</label>
        <textarea value={snapshotText} onChange={(event) => setSnapshotText(event.target.value)} placeholder="Export a snapshot or paste one here to restore it." />
      </div>
      <div className="hero-actions">
        <button className="button" onClick={exportSnapshot}>Export snapshot</button>
        <button className="button-secondary" onClick={importSnapshot}>Import snapshot</button>
        <button className="button-secondary" onClick={resetWorkspace}>Reset local workspace</button>
        <Status tone="private">{message}</Status>
      </div>
    </section>
  );
}

function readSnapshotFromStorage(): Omit<WorkspaceSnapshot, "product" | "version" | "exportedAt"> {
  return {
    dnaMatches: readJson<StoredDnaMatch[]>(workspaceStorageKeys.dnaMatches, []),
    dnaHypothesis: readJson<DnaConnectionHypothesis | undefined>(workspaceStorageKeys.dnaHypothesis, undefined),
    cases: readJson<ResearchCase[]>(workspaceStorageKeys.cases, []),
    importPreviews: readJson<StoredImportPreview[]>(workspaceStorageKeys.importPreviews, [])
  };
}

function writeSnapshotToStorage(snapshot: WorkspaceSnapshot) {
  window.localStorage.setItem(workspaceStorageKeys.dnaMatches, JSON.stringify(snapshot.dnaMatches));
  if (snapshot.dnaHypothesis) {
    window.localStorage.setItem(workspaceStorageKeys.dnaHypothesis, JSON.stringify(snapshot.dnaHypothesis));
  }
  window.localStorage.setItem(workspaceStorageKeys.cases, JSON.stringify(snapshot.cases));
  window.localStorage.setItem(workspaceStorageKeys.importPreviews, JSON.stringify(snapshot.importPreviews));
}

function readJson<T>(key: string, fallback: T): T {
  const value = window.localStorage.getItem(key);
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <span>stored locally</span>
    </div>
  );
}
