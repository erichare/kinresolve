"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  betaActionTokenFromFragment,
  betaInvitationErrorMessage,
  betaLegalAcceptanceFromInspection,
  betaRequestIdFromResponse,
  betaVerificationDeliveryFromAcceptance,
  parseBetaInvitationInspection,
  type BetaInvitationInspection,
  type BetaLegalDocumentSummary,
  type BetaVerificationDelivery
} from "@/lib/beta-onboarding-browser";
import { isRetryableBrowserActionStatus } from "@/lib/browser-action-retry";
import { Status } from "./ui";

type InvitationStatus =
  | "initializing"
  | "inspecting"
  | "inspection-retryable"
  | "ready"
  | "submitting"
  | "accept-retryable"
  | "invalid"
  | "complete";

const legalDocumentKeys = ["participationTerms", "privacyNotice", "betaBoundary"] as const;
const legalDocumentPaths = {
  participationTerms: "participation-terms",
  privacyNotice: "privacy-notice",
  betaBoundary: "beta-boundary"
} as const;

export function BetaInvitationForm() {
  const initialized = useRef(false);
  const inspectionStarted = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const [inspection, setInspection] = useState<BetaInvitationInspection | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<InvitationStatus>("initializing");
  const [verificationDelivery, setVerificationDelivery] = useState<BetaVerificationDelivery | null>(null);

  const inspectInvitation = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      setStatus("invalid");
      return;
    }
    if (inspectionStarted.current) return;
    inspectionStarted.current = true;
    setRequestId(null);
    setStatus("inspecting");

    try {
      const response = await fetch("/api/beta/invitations/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token })
      });
      if (!response.ok) {
        setRequestId(betaRequestIdFromResponse(response));
        if (isRetryableBrowserActionStatus(response.status)) {
          inspectionStarted.current = false;
          setStatus("inspection-retryable");
          return;
        }
        tokenRef.current = null;
        setStatus("invalid");
        return;
      }

      const safeInspection = parseBetaInvitationInspection(await response.json() as unknown);
      if (!safeInspection) {
        setRequestId(betaRequestIdFromResponse(response));
        inspectionStarted.current = false;
        setStatus("inspection-retryable");
        return;
      }

      setInspection(safeInspection);
      setStatus("ready");
    } catch {
      inspectionStarted.current = false;
      setStatus("inspection-retryable");
    }
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      tokenRef.current = betaActionTokenFromFragment(window.location.hash);
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }

    if (!tokenRef.current) {
      setStatus("invalid");
      return;
    }
    void inspectInvitation();
  }, [inspectInvitation]);

  async function acceptInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = tokenRef.current;
    if (!token || !inspection || !accepted) {
      setStatus("invalid");
      return;
    }

    setRequestId(null);
    setStatus("submitting");
    try {
      const response = await fetch("/api/beta/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          token,
          name: name.trim(),
          email,
          password,
          acceptance: betaLegalAcceptanceFromInspection(inspection)
        })
      });
      if (!response.ok) {
        setRequestId(betaRequestIdFromResponse(response));
        setPassword("");
        if (isRetryableBrowserActionStatus(response.status)) {
          setStatus("accept-retryable");
          return;
        }
        tokenRef.current = null;
        setStatus("invalid");
        return;
      }

      const payload: unknown = await response.json().catch(() => null);
      setVerificationDelivery(betaVerificationDeliveryFromAcceptance(payload));
      tokenRef.current = null;
      setName("");
      setEmail("");
      setPassword("");
      setStatus("complete");
    } catch {
      setPassword("");
      setStatus("accept-retryable");
    }
  }

  if (status === "initializing" || status === "inspecting") {
    return <p className="muted">Checking your invitation...</p>;
  }

  if (status === "inspection-retryable") {
    return (
      <div aria-atomic="true" className="form-grid" role="alert" style={{ gridTemplateColumns: "1fr" }}>
        <Status tone="warning">
          We could not check this invitation right now. The link is still available in this tab; try again.
          {requestId ? ` Reference: ${requestId}.` : ""}
        </Status>
        <button className="button-secondary" onClick={() => { void inspectInvitation(); }} type="button">
          Try checking again
        </button>
      </div>
    );
  }

  if (status === "invalid" || !inspection) {
    return (
      <div aria-atomic="true" role="alert">
        <Status tone="warning">
          {betaInvitationErrorMessage}{requestId ? ` Reference: ${requestId}.` : ""}
        </Status>
      </div>
    );
  }

  if (status === "complete") {
    return (
      <div aria-atomic="true" aria-live="polite" className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        {verificationDelivery === "sent" ? (
          <Status>
            Your invitation was accepted. Check your email for a verification link before signing in.
          </Status>
        ) : (
          <>
            <Status tone="warning">
              Your invitation was accepted, but we could not send the verification email. Request a new verification
              email before signing in.
            </Status>
            <Link className="button-secondary" href="/resend-verification">
              Request a new verification email
            </Link>
          </>
        )}
      </div>
    );
  }

  const busy = status === "submitting";

  return (
    <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
      <section aria-labelledby="invitation-details-heading">
        <h2 id="invitation-details-heading">Invitation details</h2>
        <dl>
          <div><dt>Workspace</dt><dd>{inspection.archiveName}</dd></div>
          <div><dt>Role</dt><dd>{humanize(inspection.role)}</dd></div>
          <div><dt>Purpose</dt><dd>{humanize(inspection.purpose)}</dd></div>
          <div><dt>Expires</dt><dd><time dateTime={inspection.expiresAt}>{formatTimestamp(inspection.expiresAt)}</time></dd></div>
        </dl>
      </section>

      <section aria-labelledby="invitation-legal-heading">
        <h2 id="invitation-legal-heading">Private beta agreements</h2>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
          {legalDocumentKeys.map((key) => (
            <LegalDocument document={inspection.legal[key]} documentKey={key} key={key} />
          ))}
        </div>
      </section>

      {status === "accept-retryable" ? (
        <div aria-atomic="true" role="alert">
          <Status tone="warning">
            We could not accept this invitation right now. The link is still available in this tab; enter your
            password and try again.{requestId ? ` Reference: ${requestId}.` : ""}
          </Status>
        </div>
      ) : null}

      <form aria-busy={busy} className="form-grid" style={{ gridTemplateColumns: "1fr" }} onSubmit={acceptInvitation}>
        <label className="field">
          <span>Name</span>
          <input
            autoComplete="name"
            disabled={busy}
            maxLength={100}
            required
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Invited email</span>
          <input
            autoComplete="email"
            disabled={busy}
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Password (10–128 characters)</span>
          <input
            autoComplete="new-password"
            disabled={busy}
            maxLength={128}
            minLength={10}
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="research-confirmation">
          <input
            checked={accepted}
            disabled={busy}
            required
            type="checkbox"
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span>
            I accept the exact participation terms, privacy notice, and beta boundary identified above.
          </span>
        </label>
        <button aria-busy={busy} className="button" disabled={busy || !accepted} type="submit">
          {busy
            ? "Accepting invitation..."
            : status === "accept-retryable"
              ? "Try accepting again"
              : "Accept invitation"}
        </button>
      </form>
    </div>
  );
}

function LegalDocument({
  document,
  documentKey
}: {
  document: BetaLegalDocumentSummary;
  documentKey: (typeof legalDocumentKeys)[number];
}) {
  return (
    <article className="panel" style={{ boxShadow: "none" }}>
      <h3>{document.title}</h3>
      <p className="muted">Version {document.version}</p>
      <p style={{ overflowWrap: "anywhere" }}><strong>SHA-256:</strong> <code>{document.sha256}</code></p>
      <a
        className="button-secondary"
        href={`/api/beta/legal/${legalDocumentPaths[documentKey]}`}
        rel="noreferrer noopener"
        target="_blank"
      >
        Read verified document
      </a>
    </article>
  );
}

function humanize(value: string): string {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}
