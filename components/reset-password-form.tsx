"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { isRetryableBrowserActionStatus } from "@/lib/browser-action-retry";
import {
  passwordResetFailureMessage,
  passwordResetTokenFromFragment
} from "@/lib/password-recovery";
import { Status } from "./ui";

type FormStatus = "initializing" | "ready" | "loading" | "retryable" | "invalid" | "error" | "complete";

const passwordResetRetryMessage =
  "We could not reset your password right now. The link is still available in this tab; enter a new password and try again.";

export function ResetPasswordForm() {
  const initialized = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<FormStatus>("initializing");
  const [message, setMessage] = useState(passwordResetFailureMessage);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    tokenRef.current = passwordResetTokenFromFragment(window.location.hash);

    // Replace the current history entry before accepting any input. Dropping
    // both search and fragment ensures a token supplied in the wrong URL area
    // is neither consumed nor left in browser history.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    setStatus(tokenRef.current ? "ready" : "invalid");
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = tokenRef.current;
    if (!token) {
      setMessage(passwordResetFailureMessage);
      setStatus("invalid");
      return;
    }

    if (password !== confirmation) {
      setMessage("The passwords do not match.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token
      });
      if (result.error) {
        setPassword("");
        setConfirmation("");
        if (isRetryableBrowserActionStatus(result.error.status)) {
          setMessage(passwordResetRetryMessage);
          setStatus("retryable");
          return;
        }
        tokenRef.current = null;
        setMessage(passwordResetFailureMessage);
        setStatus("invalid");
        return;
      }

      tokenRef.current = null;
      setPassword("");
      setConfirmation("");
      setStatus("complete");
    } catch {
      setPassword("");
      setConfirmation("");
      setMessage(passwordResetRetryMessage);
      setStatus("retryable");
    }
  }

  if (status === "initializing") {
    return <p className="muted">Checking the password-reset link...</p>;
  }

  if (status === "complete") {
    return (
      <div aria-atomic="true" aria-live="polite" className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <Status>Your password has been reset. Sign in with your new password.</Status>
        <Link className="button" href="/login">
          Continue to sign in
        </Link>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div aria-atomic="true" className="form-grid" role="alert" style={{ gridTemplateColumns: "1fr" }}>
        <Status tone="warning">{passwordResetFailureMessage}</Status>
        <Link className="button-secondary" href="/forgot-password">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form aria-busy={status === "loading"} className="form-grid" style={{ gridTemplateColumns: "1fr" }} onSubmit={submit}>
      <label className="field">
        <span>New password (at least 10 characters)</span>
        <input
          aria-describedby={status === "error" || status === "retryable" ? "reset-password-error" : undefined}
          aria-invalid={status === "error" || status === "retryable"}
          autoComplete="new-password"
          disabled={status === "loading"}
          maxLength={128}
          minLength={10}
          required
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Confirm new password</span>
        <input
          aria-describedby={status === "error" || status === "retryable" ? "reset-password-error" : undefined}
          aria-invalid={status === "error" || status === "retryable"}
          autoComplete="new-password"
          disabled={status === "loading"}
          maxLength={128}
          minLength={10}
          required
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <button aria-busy={status === "loading"} className="button" disabled={status === "loading"} type="submit">
        {status === "loading"
          ? "Resetting password..."
          : status === "retryable"
            ? "Try resetting again"
            : "Reset password"}
      </button>
      {status === "error" || status === "retryable" ? (
        <span aria-atomic="true" id="reset-password-error" role="alert">
          <Status tone="warning">{message}</Status>
        </span>
      ) : null}
    </form>
  );
}
