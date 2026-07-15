"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { passwordResetRequestMessage } from "@/lib/password-recovery";
import { Status } from "./ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "complete">("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");

    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password"
      });
    } catch {
      // Deliberately return the identical result for unknown accounts, provider
      // failures, and network failures. The participant can retry or contact
      // support without this surface becoming an account-enumeration oracle.
    }

    setStatus("complete");
  }

  if (status === "complete") {
    return (
      <div aria-atomic="true" aria-live="polite" className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <Status>{passwordResetRequestMessage}</Status>
        <Link className="button-secondary" href="/login">
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <form aria-busy={status === "loading"} className="form-grid" style={{ gridTemplateColumns: "1fr" }} onSubmit={submit}>
      <label className="field">
        <span>Email</span>
        <input
          autoComplete="email"
          disabled={status === "loading"}
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <button aria-busy={status === "loading"} className="button" disabled={status === "loading"} type="submit">
        {status === "loading" ? "Requesting reset..." : "Send password-reset email"}
      </button>
    </form>
  );
}
