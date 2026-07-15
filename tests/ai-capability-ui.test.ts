import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AIAnalystWorkspace } from "@/components/ai-analyst-workspace";

const baseProps = {
  initialQuestion: "Which source should I verify next?",
  cases: [],
  initialRuns: [],
  anomalies: [],
  counts: { people: 12, cases: 0, dnaHypotheses: 3 },
  dnaHypotheses: []
};

describe("AI analyst capability UI", () => {
  it("presents local-only analysis without DNA when both capabilities are disabled", () => {
    const html = renderToStaticMarkup(createElement(AIAnalystWorkspace, {
      ...baseProps,
      dnaEnabled: false,
      externalAiEnabled: false
    }));

    expect(html).not.toMatch(/DNA/i);
    expect(html).toMatch(/deterministic local checks/i);
    expect(html).toMatch(/no external provider/i);
    expect(html).not.toMatch(/sends full private workspace context/i);
    expect(html).not.toMatch(/provider fallback|provider answered/i);
  });

  it("preserves DNA and provider-aware copy when capabilities are enabled", () => {
    const html = renderToStaticMarkup(createElement(AIAnalystWorkspace, {
      ...baseProps,
      dnaEnabled: true,
      externalAiEnabled: true
    }));

    expect(html).toMatch(/DNA hypotheses/i);
    expect(html).toMatch(/sends full private workspace context/i);
  });
});
