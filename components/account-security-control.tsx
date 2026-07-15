"use client";

import { useEffect, useRef, useState } from "react";
import { betaRequestIdFromResponse } from "@/lib/beta-onboarding-browser";
import { Status } from "./ui";

type ControlStatus = "idle" | "confirming" | "loading" | "error";

const revokeSessionsError =
  "We could not confirm that every session was signed out. Try again, or return to sign in.";

export function AccountSecurityControl() {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<ControlStatus>("idle");
  const [requestId, setRequestId] = useState<string | null>(null);
  const confirmationVisible = status !== "idle";

  useEffect(() => {
    if (status === "confirming") confirmButtonRef.current?.focus();
  }, [status]);

  async function revokeAllSessions() {
    setStatus("loading");

    try {
      const response = await fetch("/api/auth/security/revoke-sessions", {
        method: "POST",
        cache: "no-store"
      });
      if (!response.ok) {
        setRequestId(betaRequestIdFromResponse(response));
        setStatus("error");
        return;
      }

      window.location.assign("/login?reason=sessions-revoked");
    } catch {
      setRequestId(null);
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="account-security-heading" className="app-card" style={{ marginTop: 20 }}>
      <div className="app-card-header">
        <div>
          <h2 id="account-security-heading">Account security</h2>
          <p className="muted">
            End every active Kin Resolve session if a device is lost, shared, or no longer trusted.
          </p>
        </div>
        <Status tone="private">Sessions stay private</Status>
      </div>

      {!confirmationVisible ? (
        <button
          aria-controls="revoke-sessions-confirmation"
          aria-expanded="false"
          className="button-secondary danger-action"
          onClick={() => setStatus("confirming")}
          type="button"
        >
          Sign out all sessions
        </button>
      ) : (
        <div
          aria-labelledby="revoke-sessions-confirmation-heading"
          className="form-grid"
          id="revoke-sessions-confirmation"
          role="group"
          style={{ gridTemplateColumns: "1fr", marginTop: 16 }}
        >
          <div>
            <strong id="revoke-sessions-confirmation-heading">Sign out everywhere?</strong>
            <p className="muted">
              This immediately ends every active session, including this device. You will need to sign in again.
            </p>
          </div>
          <button
            aria-busy={status === "loading"}
            className="button-secondary danger-action"
            disabled={status === "loading"}
            onClick={revokeAllSessions}
            ref={confirmButtonRef}
            type="button"
          >
            {status === "loading" ? "Signing out everywhere..." : "Confirm and sign out everywhere"}
          </button>
          <button
            className="button-secondary"
            disabled={status === "loading"}
            onClick={() => setStatus("idle")}
            type="button"
          >
            Cancel
          </button>
          {status === "error" ? (
            <span aria-atomic="true" role="alert">
              <Status tone="warning">
                {revokeSessionsError}{requestId ? ` Reference: ${requestId}.` : ""}
              </Status>
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}
