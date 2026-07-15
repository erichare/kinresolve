"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  betaActionTokenFromFragment,
  betaEmailVerificationErrorMessage,
  betaRequestIdFromResponse
} from "@/lib/beta-onboarding-browser";
import { isRetryableBrowserActionStatus } from "@/lib/browser-action-retry";
import { Status } from "./ui";

type VerificationStatus = "initializing" | "verifying" | "retryable" | "invalid" | "complete";

export function BetaEmailVerification() {
  const initialized = useRef(false);
  const requestStarted = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<VerificationStatus>("initializing");
  const [requestId, setRequestId] = useState<string | null>(null);

  const verifyEmail = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      setStatus("invalid");
      return;
    }
    if (requestStarted.current) return;
    requestStarted.current = true;
    setRequestId(null);
    setStatus("verifying");

    try {
      const response = await fetch("/api/beta/email-verification/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token })
      });
      if (!response.ok) {
        setRequestId(betaRequestIdFromResponse(response));
        if (isRetryableBrowserActionStatus(response.status)) {
          requestStarted.current = false;
          setStatus("retryable");
          return;
        }
        tokenRef.current = null;
        setStatus("invalid");
        return;
      }

      tokenRef.current = null;
      setStatus("complete");
    } catch {
      requestStarted.current = false;
      setStatus("retryable");
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
    void verifyEmail();
  }, [verifyEmail]);

  if (status === "initializing" || status === "verifying") {
    return <p className="muted">Verifying your email address...</p>;
  }

  if (status === "complete") {
    return (
      <div aria-atomic="true" aria-live="polite" className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <Status>Your email address is verified. You can now sign in to Kin Resolve.</Status>
        <Link className="button" href="/login">
          Continue to sign in
        </Link>
      </div>
    );
  }

  if (status === "retryable") {
    return (
      <div aria-atomic="true" className="form-grid" role="alert" style={{ gridTemplateColumns: "1fr" }}>
        <Status tone="warning">
          We could not verify your email right now. The link is still available in this tab; try again.
          {requestId ? ` Reference: ${requestId}.` : ""}
        </Status>
        <button className="button-secondary" onClick={() => { void verifyEmail(); }} type="button">
          Try verification again
        </button>
      </div>
    );
  }

  return (
    <div aria-atomic="true" className="form-grid" role="alert" style={{ gridTemplateColumns: "1fr" }}>
      <Status tone="warning">
        {betaEmailVerificationErrorMessage}{requestId ? ` Reference: ${requestId}.` : ""}
      </Status>
      <Link className="button-secondary" href="/resend-verification">
        Request a new verification email
      </Link>
      <Link className="button-secondary" href="/login">
        Return to sign in
      </Link>
    </div>
  );
}
