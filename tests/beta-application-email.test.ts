import { describe, expect, it } from "vitest";

import { createTransactionalEmailIdempotencyKey } from "@/lib/transactional-email";
import {
  renderBetaApplicationFounderEmail,
  renderBetaApplicationReceiptEmail
} from "@/lib/transactional-email-templates";

const applicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("beta application transactional email", () => {
  it("uses distinct stable application-ID idempotency namespaces", () => {
    expect(createTransactionalEmailIdempotencyKey("application-receipt", applicationId))
      .toBe(`kinresolve:application-receipt:${applicationId}`);
    expect(createTransactionalEmailIdempotencyKey("application-founder", applicationId))
      .toBe(`kinresolve:application-founder:${applicationId}`);
  });

  it("escapes applicant fields in both templates and keeps subjects injection-proof", () => {
    const hostileName = "Pilot <img src=x onerror=alert(1)> Researcher";
    const hostileTool = "other";
    const receipt = renderBetaApplicationReceiptEmail({ applicationId, name: hostileName });
    const founder = renderBetaApplicationFounderEmail({
      applicationId,
      archiveSizeBand: "under-1000",
      currentTool: hostileTool,
      email: "pilot@example.com",
      name: hostileName,
      researcherType: "family-historian",
      workflow: "source-research"
    });
    expect(receipt.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(founder.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(receipt.html).not.toContain("<img src=x");
    expect(founder.html).not.toContain("<img src=x");
    expect(receipt.subject).toBe("Kin Resolve private beta application received");
    expect(founder.subject).toBe("New Kin Resolve private beta application");
    expect(`${receipt.text}\n${founder.text}`).toMatch(/do not (reply with|request) family records/i);
  });

  it("rejects control/header injection before rendering", () => {
    expect(() => renderBetaApplicationReceiptEmail({
      applicationId,
      name: "Pilot\r\nBcc: leak@example.com"
    })).toThrow(/name/i);
    expect(() => renderBetaApplicationFounderEmail({
      applicationId,
      archiveSizeBand: "under-1000",
      currentTool: null,
      email: "pilot@example.com\nBcc: leak@example.com",
      name: "Pilot",
      researcherType: "family-historian",
      workflow: "source-research"
    })).toThrow(/email/i);
  });
});
