"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { recordPlausibleEvent } from "@/lib/plausible-client";
import {
  publicDemoGuidedStartPath,
  publicDemoNoticeVersion
} from "@/lib/public-demo-contract";

type StartResponse = {
  workspaceUrl?: string;
  url?: string;
  error?: string;
  familyUrl?: string;
  challengeUrl?: string;
};

type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
};

type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
};

const turnstileScriptSource =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const widgetFailureTimeoutMs = 8_000;
const maximumRetryAfterSeconds = 900;

export interface DemoStartFormProps {
  turnstileMode?: "off" | "shadow" | "required";
  turnstileSiteKey?: string;
}

export function DemoStartForm({ turnstileMode = "off", turnstileSiteKey }: DemoStartFormProps) {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showFallback, setShowFallback] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [widgetFailed, setWidgetFailed] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const readyTimer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(readyTimer);
  }, []);

  // Explicit Turnstile widget render: the challenge is a progressive layer.
  // If the script or widget fails, widgetFailed switches the form to its
  // stateless fallback guidance — the visitor is never left with a dead
  // button and no path.
  useEffect(() => {
    if (turnstileMode === "off" || !turnstileSiteKey) return undefined;
    let cancelled = false;
    let rendered = false;
    const failTimer = window.setTimeout(() => {
      if (!rendered && !cancelled) setWidgetFailed(true);
    }, widgetFailureTimeoutMs);

    function renderWidget(): void {
      if (cancelled || rendered) return;
      const api = (window as { turnstile?: TurnstileApi }).turnstile;
      const container = widgetRef.current;
      if (!api || !container || !turnstileSiteKey) return;
      try {
        api.render(container, {
          sitekey: turnstileSiteKey,
          action: "demo-session",
          callback: (token: string) => {
            if (!cancelled) {
              setTurnstileToken(token);
              setWidgetFailed(false);
            }
          },
          "error-callback": () => {
            if (!cancelled) setWidgetFailed(true);
          },
          "expired-callback": () => {
            if (!cancelled) setTurnstileToken("");
          }
        });
        rendered = true;
      } catch {
        if (!cancelled) setWidgetFailed(true);
      }
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/"]'
    );
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = turnstileScriptSource;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
    if ((window as { turnstile?: TurnstileApi }).turnstile) {
      renderWidget();
    } else {
      script.addEventListener("load", renderWidget);
      script.addEventListener("error", () => {
        if (!cancelled) setWidgetFailed(true);
      });
    }
    return () => {
      cancelled = true;
      window.clearTimeout(failTimer);
      script.removeEventListener("load", renderWidget);
    };
  }, [turnstileMode, turnstileSiteKey]);

  // At-capacity countdown: the server's Retry-After header drives a visible
  // ticking wait, and the start button re-enables itself when it reaches zero.
  useEffect(() => {
    if (retryAfterSeconds <= 0) return undefined;
    const tick = window.setTimeout(() => {
      setRetryAfterSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearTimeout(tick);
  }, [retryAfterSeconds]);

  async function startDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setShowFallback(false);

    try {
      const response = await fetch("/api/demo/sessions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noticeVersion: publicDemoNoticeVersion,
          ...(turnstileToken ? { turnstileToken } : {})
        })
      });
      const payload = (await response.json().catch(() => ({}))) as StartResponse;
      if (!response.ok) {
        setError(payload.error || "The demo is busy right now. Try again in a moment.");
        setShowFallback(
          (response.status === 429 || response.status === 403)
          && payload.familyUrl === "/family"
          && payload.challengeUrl === "/challenge"
        );
        if (response.status === 429) {
          setRetryAfterSeconds(parseRetryAfterSeconds(response.headers.get("retry-after")));
        }
        setPending(false);
        return;
      }

      recordPlausibleEvent("demo_session_started");
      window.location.assign(payload.workspaceUrl || payload.url || publicDemoGuidedStartPath);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo could not start. Please try again.");
      setPending(false);
    }
  }

  const waiting = retryAfterSeconds > 0;
  return (
    <form action="/api/demo/sessions" method="post" onSubmit={startDemo}>
      <input name="noticeVersion" type="hidden" value={publicDemoNoticeVersion} />
      {turnstileMode !== "off" && turnstileSiteKey ? (
        <div
          aria-label="Automated-traffic check"
          className="demo-turnstile-widget"
          data-demo-turnstile-mode={turnstileMode}
          ref={widgetRef}
        />
      ) : null}
      <button className="button" disabled={!ready || pending || waiting} type="submit">
        {pending
          ? "Preparing your workspace…"
          : waiting
            ? `Try again in ${retryAfterSeconds}s`
            : "Start guided demo"}
      </button>
      <div aria-live="polite" className={error ? "form-error" : "sr-only"} role={error ? "alert" : "status"}>
        <p>{error || (pending ? "Preparing a private fictional workspace." : "")}</p>
        {waiting ? (
          <p>The demo frees up as visitors finish. You can retry in {retryAfterSeconds} seconds.</p>
        ) : null}
        {showFallback ? (
          <nav aria-label="Other fictional demo options">
            <a href="/family">Explore the fictional family</a>
            {" · "}
            <a href="/challenge">Try the research challenge</a>
          </nav>
        ) : null}
      </div>
      {widgetFailed && turnstileMode === "required" ? (
        <div className="form-error" role="note">
          <p>The automated-traffic check did not load, so a guided session may be refused.</p>
          <nav aria-label="Fallback fictional demo options">
            <a href="/family">Explore the fictional family</a>
            {" · "}
            <a href="/challenge">Try the research challenge</a>
          </nav>
        </div>
      ) : null}
    </form>
  );
}

function parseRetryAfterSeconds(value: string | null): number {
  if (!value || !/^\d{1,6}$/.test(value)) return 60;
  return Math.min(maximumRetryAfterSeconds, Math.max(1, Number(value)));
}
