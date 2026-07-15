"use client";

import { useEffect, useMemo, useState } from "react";

import { apiV1Scopes, type ApiV1Scope } from "@/lib/api-v1-contract";
import { Status } from "./ui";

type TokenMetadata = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiV1Scope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
};

const scopeLabels: Record<ApiV1Scope, string> = {
  "archive:read": "People and archive metadata",
  "sources:read": "Sources",
  "cases:read": "Research cases",
  "reports:read": "Quality reports",
  "archive:export": "Full GEDCOM export"
};

export function apiTokenCreationAllowed(input: {
  confirmArchiveExport: boolean;
  includesExport: boolean;
  name: string;
  oneTimeTokenPresent: boolean;
  scopeCount: number;
}): boolean {
  return !input.oneTimeTokenPresent
    && input.name.trim().length > 0
    && input.scopeCount > 0
    && (!input.includesExport || input.confirmArchiveExport);
}

export function ApiTokenControl() {
  const [tokens, setTokens] = useState<TokenMetadata[]>([]);
  const [name, setName] = useState("Developer quickstart");
  const [scopes, setScopes] = useState<ApiV1Scope[]>(["archive:read"]);
  const [expiryDays, setExpiryDays] = useState(30);
  const [confirmArchiveExport, setConfirmArchiveExport] = useState(false);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadTokens() {
      try {
        const response = await fetch("/api/settings/api-tokens", {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) throw new Error(await responseError(response));
        const body = await response.json() as { tokens: TokenMetadata[] };
        if (cancelled) return;
        setTokens(body.tokens);
        setStatus("idle");
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "API tokens could not be loaded.");
        setStatus("error");
      }
    }
    void loadTokens();
    return () => { cancelled = true; };
  }, []);

  const includesExport = scopes.includes("archive:export");
  const canCreate = useMemo(
    () => apiTokenCreationAllowed({
      confirmArchiveExport,
      includesExport,
      name,
      oneTimeTokenPresent: oneTimeToken !== null,
      scopeCount: scopes.length
    }),
    [confirmArchiveExport, includesExport, name, oneTimeToken, scopes.length]
  );

  function toggleScope(scope: ApiV1Scope) {
    setScopes((current) => current.includes(scope)
      ? current.filter((candidate) => candidate !== scope)
      : apiV1Scopes.filter((candidate) => current.includes(candidate) || candidate === scope));
    if (scope === "archive:export") setConfirmArchiveExport(false);
  }

  async function createToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;
    setStatus("saving");
    setMessage(null);
    setOneTimeToken(null);
    try {
      const response = await fetch("/api/settings/api-tokens", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60_000).toISOString(),
          confirmArchiveExport
        })
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as { token: string; metadata: TokenMetadata };
      setOneTimeToken(body.token);
      setTokens((current) => [body.metadata, ...current]);
      setStatus("idle");
      setMessage("Token created. Copy it now; Kin Resolve cannot show it again.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The token could not be created.");
    }
  }

  async function copyToken() {
    if (!oneTimeToken) return;
    try {
      await navigator.clipboard.writeText(oneTimeToken);
      setMessage("Token copied. Store it in a password manager or secret store.");
    } catch {
      setMessage("Copy was unavailable. Select the token text and copy it manually.");
    }
  }

  async function revokeToken(tokenId: string) {
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch(`/api/settings/api-tokens/${encodeURIComponent(tokenId)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as { id: string; revokedAt: string };
      setTokens((current) => current.map((token) => token.id === body.id
        ? { ...token, active: false, revokedAt: body.revokedAt }
        : token));
      setConfirmRevokeId(null);
      setStatus("idle");
      setMessage("Token revoked. Its next API request will be denied.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The token could not be revoked.");
    }
  }

  return (
    <section aria-labelledby="developer-api-heading" className="app-card" style={{ marginTop: 20 }}>
      <div className="app-card-header">
        <div>
          <h2 id="developer-api-heading">Developer API</h2>
          <p className="muted">
            Create a short-lived, read-only token for this archive. Secrets are shown once and stored only as a digest.
          </p>
        </div>
        <Status tone="private">Developer Preview</Status>
      </div>

      <form className="form-grid" onSubmit={createToken}>
        <label className="field">
          <span>Token name</span>
          <input
            autoComplete="off"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="field">
          <span>Expires after</span>
          <select onChange={(event) => setExpiryDays(Number(event.target.value))} value={expiryDays}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <fieldset className="field api-token-scopes" style={{ gridColumn: "1 / -1" }}>
          <legend>Scopes</legend>
          {apiV1Scopes.map((scope) => (
            <label className="api-token-scope" key={scope}>
              <input
                className="api-token-checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
                type="checkbox"
              />
              <span><code>{scope}</code> — {scopeLabels[scope]}</span>
            </label>
          ))}
        </fieldset>
        {includesExport ? (
          <label className="field api-token-export-confirmation" style={{ gridColumn: "1 / -1" }}>
            <span>
              <input
                className="api-token-checkbox"
                checked={confirmArchiveExport}
                onChange={(event) => setConfirmArchiveExport(event.target.checked)}
                type="checkbox"
              />
              I understand this token can download the complete GEDCOM archive.
            </span>
          </label>
        ) : null}
        <button className="button" disabled={!canCreate || status === "saving"} type="submit">
          {status === "saving" ? "Working…" : "Create token"}
        </button>
      </form>

      {oneTimeToken ? (
        <div aria-live="polite" className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 20 }}>
          <Status tone="warning">Shown once — copy this secret before dismissing it</Status>
          <pre className="code-block" style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{oneTimeToken}</pre>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button className="button-secondary" onClick={copyToken} type="button">Copy token</button>
            <button className="button-secondary" onClick={() => setOneTimeToken(null)} type="button">I stored it securely</button>
          </div>
        </div>
      ) : null}

      <div className="app-card-header" style={{ marginTop: 28 }}>
        <div>
          <h3>Archive tokens</h3>
          <p className="muted">Only the non-secret prefix is available after creation.</p>
        </div>
        <a href="https://kinresolve.com/developers/" rel="noreferrer" target="_blank">Developer docs ↗</a>
      </div>
      {status === "loading" ? <p className="muted" role="status">Loading tokens…</p> : null}
      {tokens.length > 0 ? (
        <div
          aria-label="Archive API tokens"
          role="region"
          style={{ overflowX: "auto" }}
          tabIndex={0}
        >
          <table className="data-table">
            <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Expires</th><th>Action</th></tr></thead>
            <tbody>
              {tokens.map((token) => {
                return (
                  <tr key={token.id}>
                    <td>{token.name}</td>
                    <td><code>{token.prefix}…</code></td>
                    <td>{token.scopes.join(", ")}</td>
                    <td>{token.lastUsedAt ? formatDate(token.lastUsedAt) : "Never"}</td>
                    <td>{formatDate(token.expiresAt)}</td>
                    <td>
                      {!token.active ? (
                        <Status tone="private">{token.revokedAt ? "Revoked" : "Expired"}</Status>
                      ) : confirmRevokeId === token.id ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="button-secondary danger-action"
                            disabled={status === "saving"}
                            onClick={() => { void revokeToken(token.id); }}
                            type="button"
                          >Confirm revoke</button>
                          <button className="button-secondary" onClick={() => setConfirmRevokeId(null)} type="button">Cancel</button>
                        </div>
                      ) : (
                        <button className="button-secondary danger-action" onClick={() => setConfirmRevokeId(token.id)} type="button">Revoke</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : status !== "loading" ? <p className="muted">No API tokens yet.</p> : null}
      {message ? <p className={status === "error" ? "form-error" : "muted"} role="status" style={{ marginTop: 12 }}>{message}</p> : null}
    </section>
  );
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? "The API token operation could not be completed.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
