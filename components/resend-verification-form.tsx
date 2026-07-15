"use client";

import Link from "next/link";
import { useState } from "react";
import {
  requestBetaVerificationReissue,
  verificationReissueGenericMessage
} from "@/lib/verification-reissue-browser";
import { Status } from "./ui";

export function ResendVerificationForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "complete">("idle");
  const [message, setMessage] = useState(verificationReissueGenericMessage);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");

    try {
      setMessage(await requestBetaVerificationReissue(email));
    } finally {
      // Preserve the same public completion state even if the helper itself
      // unexpectedly fails before projecting the request result.
      setStatus("complete");
    }
  }

  if (status === "complete") {
    return (
      <div aria-atomic="true" aria-live="polite" className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <Status>{message}</Status>
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
        {status === "loading" ? "Requesting verification..." : "Resend verification email"}
      </button>
    </form>
  );
}
