import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildSourceSubmission,
  SourceWorkspace
} from "@/components/source-workspace";

const emptyResult = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 50,
  pageCount: 1,
  start: 0,
  end: 0,
  stats: {
    total: 0,
    linked: 0,
    unlinked: 0,
    publicCount: 0,
    protectedCount: 0,
    transcripts: 0
  },
  types: []
};

const sourceForm = {
  title: "Synthetic transcript",
  sourceType: "Document",
  repository: "Synthetic archive",
  citationDate: "2026-07-14",
  linkedPersonId: "",
  linkedCaseId: "",
  transcript: "Wholly synthetic evidence text.",
  notes: "",
  privacy: "private",
  confidence: "0.70"
};

describe("source workspace capabilities", () => {
  it("renders transcript-only capture without a file control when binary uploads are disabled", () => {
    const html = renderToStaticMarkup(createElement(SourceWorkspace, {
      caseOptions: [],
      initialPersonOptions: [],
      initialResult: emptyResult,
      evidenceBinaryUploadsEnabled: false
    }));

    expect(html).not.toMatch(/<input\b[^>]*type="file"/i);
    expect(html).toMatch(/transcript-only/i);
    expect(html).toMatch(/paste(?:d)? text/i);
  });

  it("submits transcript-only sources as JSON even if stale client state contains a file", () => {
    const file = new File(["private bytes"], "private.pdf", { type: "application/pdf" });
    const submission = buildSourceSubmission(sourceForm, file, false);

    expect(submission.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(submission.body))).toEqual(sourceForm);
    expect(String(submission.body)).not.toContain("private.pdf");
  });

  it("preserves the multipart file path when binary uploads are enabled", () => {
    const file = new File(["private bytes"], "private.pdf", { type: "application/pdf" });
    const submission = buildSourceSubmission(sourceForm, file, true);

    expect(submission.headers).toBeUndefined();
    expect(submission.body).toBeInstanceOf(FormData);
    expect((submission.body as FormData).get("file")).toBe(file);
  });
});
