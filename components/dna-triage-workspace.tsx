"use client";

import { useEffect, useMemo, useState } from "react";
import type { DnaConnectionHypothesis, DnaMatch } from "@/lib/models";
import { workspaceStorageKeys, type StoredDnaMatch } from "@/lib/workspace-snapshot";
import { Confidence, Status } from "./ui";

type DnaAnalysisResponse = {
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
};

type Props = {
  initialMatches: Array<DnaMatch & { helpfulnessScore: number }>;
  initialHypothesis: DnaConnectionHypothesis;
};

const defaultForm = {
  displayName: "J. Fletcher",
  totalCm: "238",
  longestSegmentCm: "23.4",
  predictedRelationship: "likely 2C1R",
  side: "maternal",
  treeStatus: "partial",
  surnames: "Fletcher, Zajicek, Riemer",
  places: "Chicago, Limerick, Cornwall",
  sharedMatches: "M. O'Donnell, A. Zajicek, S. Riemer",
  notes: "Partial tree reaches a Fletcher household in Chicago with Irish and Cornwall place overlap."
};

export function DnaTriageWorkspace({ initialMatches, initialHypothesis }: Props) {
  const [matches, setMatches] = useState(initialMatches);
  const [form, setForm] = useState(defaultForm);
  const [hypothesis, setHypothesis] = useState(initialHypothesis);
  const [score, setScore] = useState(initialMatches[0]?.helpfulnessScore ?? 0);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const selectedMatch = useMemo(() => matches[0], [matches]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedMatches = readLocalJson<StoredDnaMatch[]>(workspaceStorageKeys.dnaMatches);
      const storedHypothesis = readLocalJson<DnaConnectionHypothesis>(workspaceStorageKeys.dnaHypothesis);
      if (storedMatches?.length) {
        setMatches(storedMatches);
        setScore(storedMatches[0].helpfulnessScore);
      }
      if (storedHypothesis) {
        setHypothesis(storedHypothesis);
      }
      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(workspaceStorageKeys.dnaMatches, JSON.stringify(matches));
  }, [hydrated, matches]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(workspaceStorageKeys.dnaHypothesis, JSON.stringify(hypothesis));
  }, [hydrated, hypothesis]);

  async function analyzeMatch() {
    setStatus("loading");
    setError("");

    const match: DnaMatch = {
      id: `dna-${form.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "match"}`,
      displayName: form.displayName,
      totalCm: Number(form.totalCm),
      longestSegmentCm: form.longestSegmentCm ? Number(form.longestSegmentCm) : undefined,
      predictedRelationship: form.predictedRelationship,
      side: form.side as DnaMatch["side"],
      treeStatus: form.treeStatus as DnaMatch["treeStatus"],
      surnames: splitList(form.surnames),
      places: splitList(form.places),
      sharedMatches: splitList(form.sharedMatches),
      notes: form.notes,
      triageStatus: "needs_review"
    };

    const response = await fetch("/api/dna/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(match)
    });

    if (!response.ok) {
      setStatus("error");
      setError(await response.text());
      return;
    }

    const result = (await response.json()) as DnaAnalysisResponse;
    setHypothesis(result.hypothesis);
    setScore(result.helpfulnessScore);
    setMatches((current) => [{ ...match, helpfulnessScore: result.helpfulnessScore }, ...current.filter((item) => item.id !== match.id)]);
    setStatus("idle");
  }

  return (
    <div className="app-grid">
      <div className="app-card">
        <h2>DNA match ranking</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Match</th>
              <th>Total cM</th>
              <th>Predicted</th>
              <th>Side</th>
              <th>Tree</th>
              <th>Helpfulness</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match) => (
              <tr key={match.id}>
                <td>{match.displayName}</td>
                <td>{match.totalCm}</td>
                <td>{match.predictedRelationship}</td>
                <td>{match.side}</td>
                <td>{match.treeStatus}</td>
                <td>{match.helpfulnessScore}</td>
                <td>
                  <Status tone={match.triageStatus === "high_priority" ? "warning" : "ok"}>{match.triageStatus.replace("_", " ")}</Status>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="section">
          <h2>Analyze a match</h2>
          <div className="form-grid">
            <TextField label="Match name" value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} />
            <TextField label="Total cM" value={form.totalCm} onChange={(value) => setForm({ ...form, totalCm: value })} />
            <TextField label="Longest segment cM" value={form.longestSegmentCm} onChange={(value) => setForm({ ...form, longestSegmentCm: value })} />
            <TextField label="Predicted relationship" value={form.predictedRelationship} onChange={(value) => setForm({ ...form, predictedRelationship: value })} />
            <SelectField label="Side" value={form.side} onChange={(value) => setForm({ ...form, side: value })} options={["maternal", "paternal", "both", "unknown"]} />
            <SelectField label="Tree status" value={form.treeStatus} onChange={(value) => setForm({ ...form, treeStatus: value })} options={["public", "partial", "private", "none", "unknown"]} />
            <TextField label="Surnames" value={form.surnames} onChange={(value) => setForm({ ...form, surnames: value })} />
            <TextField label="Places" value={form.places} onChange={(value) => setForm({ ...form, places: value })} />
            <TextField label="Shared matches" value={form.sharedMatches} onChange={(value) => setForm({ ...form, sharedMatches: value })} />
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Notes</label>
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </div>
          </div>
          <div className="hero-actions">
            <button className="button" disabled={status === "loading"} onClick={analyzeMatch}>
              {status === "loading" ? "Analyzing..." : "Analyze match"}
            </button>
            {status === "error" ? <Status tone="warning">Analysis failed</Status> : <Status>Helpfulness {score}</Status>}
          </div>
          {error ? <p className="muted">{error}</p> : null}
        </section>
      </div>

      <aside className="app-card">
        <h2>Match: {selectedMatch?.displayName ?? form.displayName}</h2>
        <div className="hero-actions" style={{ marginTop: 0 }}>
          <span className="tag">{selectedMatch?.totalCm ?? form.totalCm} cM</span>
          <span className="tag">{selectedMatch?.predictedRelationship ?? form.predictedRelationship}</span>
          <span className="tag">{selectedMatch?.side ?? form.side} side</span>
        </div>
        <div className="hypothesis-panel" style={{ marginTop: 18 }}>
          <h2>AI connection hypothesis</h2>
          <p>{hypothesis.explanation}</p>
          <Confidence value={hypothesis.confidence} />
          <h3>Candidate ancestors</h3>
          <ul>
            {hypothesis.candidateCommonAncestors.map((ancestor) => (
              <li key={ancestor}>{ancestor}</li>
            ))}
          </ul>
          <h3>Evidence</h3>
          <ul>
            {hypothesis.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3>Uncertainty</h3>
          <ul>
            {hypothesis.uncertainty.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </aside>
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

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
