"use client";

import { useEffect, useState } from "react";
import { demoLive } from "@/lib/demo-status";
import { site } from "@/lib/site";

// The counter contract lives in docs/public-demo-launch-materials.md: render
// only the value the live stats endpoint returns, and hide the counter
// entirely on any failure. Never render a fabricated, hardcoded, or
// stale-beyond-contract number.
const DEMO_STATS_URL = `${site.demoUrl}/api/public/demo-stats`;
const DISPLAY_THRESHOLD = 25;
const FETCH_TIMEOUT_MS = 3000;

interface DemoPulseProps {
  surface: "home" | "product";
}

function parseMysteriesSolved(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const solved = (body as { mysteriesSolved?: unknown }).mysteriesSolved;
  if (typeof solved !== "number" || !Number.isSafeInteger(solved) || solved < 0) {
    return null;
  }
  return solved;
}

export function DemoPulse({ surface }: DemoPulseProps) {
  const [mysteriesSolved, setMysteriesSolved] = useState<number | null>(null);

  useEffect(() => {
    if (!demoLive) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let cancelled = false;

    async function loadDemoStats() {
      try {
        const response = await fetch(DEMO_STATS_URL, {
          mode: "cors",
          signal: controller.signal
        });
        if (!response.ok) return;
        const solved = parseMysteriesSolved(await response.json());
        if (solved === null || cancelled) return;
        setMysteriesSolved(solved);
      } catch {
        // Unreachable or malformed endpoint: the counter stays hidden.
      } finally {
        clearTimeout(timeout);
      }
    }

    void loadDemoStats();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  if (!demoLive) return null;
  if (mysteriesSolved === null || mysteriesSolved < DISPLAY_THRESHOLD) {
    // Static exports and failed fetches share this state: an empty, hidden
    // mount point that check-export pins per mode, with no number baked in.
    return <span data-demo-pulse-surface={surface} data-demo-pulse-state="idle" hidden />;
  }
  return (
    <p className="demo-pulse" data-demo-pulse-surface={surface} data-demo-pulse-state="live">
      <strong>{mysteriesSolved.toLocaleString("en-US")}</strong> passenger mysteries solved in
      the live demo.
    </p>
  );
}
