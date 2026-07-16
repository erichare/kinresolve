import { NextResponse } from "next/server";
import { z } from "zod";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import { captureOperationalError } from "@/lib/observability";
import { recordPublicDemoEvent } from "@/lib/public-demo-session-store";
import {
  readResearchCase,
  recordCaseTaskOutcome,
  updateCaseHypothesis
} from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const guidedCaseId = "case-mercer-march-identity";
const guidedTaskId = "task-compare-signatures";
const guidedHypothesisId = "hyp-mercer-march-same";

const guideCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("start_assignment") }).strict(),
  z.object({
    command: z.literal("record_outcome"),
    outcome: z.enum(["found", "not_found", "inconclusive"])
  }).strict(),
  z.object({
    command: z.literal("hypothesis_decision"),
    decision: z.enum(["supported", "weakened", "open"])
  }).strict()
]);

const fixedOutcomeNotes = {
  found: "The two fictional signatures share the assigned distinguishing letter-shape features.",
  not_found: "The two fictional signatures do not share the assigned distinguishing letter-shape features.",
  inconclusive: "The fictional signatures share some features, but the comparison is not conclusive."
} as const;

const fixedDecisionReasons = {
  supported: "The fictional signature comparison supports the same-person hypothesis.",
  weakened: "The fictional signature comparison weakens the same-person hypothesis.",
  open: "The fictional signature comparison is inconclusive, so the hypothesis remains open."
} as const;

type RouteContext = { params: Promise<{ caseId: string }> };

export const POST = withDemoGuestCapability("demo:guide", async (request, guest, route: RouteContext) => {
  try {
    const { caseId } = await route.params;
    if (caseId !== guidedCaseId) {
      return NextResponse.json({ error: "Guided demo case not found" }, { status: 404 });
    }

    const value = await request.json();
    const parsed = guideCommandSchema.safeParse(value);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid guided demo command" }, { status: 400 });
    }

    const researchCase = await readResearchCase(caseId, { archiveId: guest.archiveId });
    if (!researchCase) {
      return NextResponse.json({ error: "Guided demo case not found" }, { status: 404 });
    }

    if (parsed.data.command === "start_assignment") {
      const task = researchCase.tasks.find((candidate) => candidate.id === guidedTaskId);
      if (!task) return NextResponse.json({ error: "Guided assignment not found" }, { status: 404 });
      await recordPublicDemoEvent({ sessionId: guest.sessionId, eventName: "guide_started" });
      return NextResponse.json({ task, next: "record_outcome" });
    }

    if (parsed.data.command === "record_outcome") {
      const task = researchCase.tasks.find((candidate) => candidate.id === guidedTaskId);
      if (!task?.updatedAt) {
        return NextResponse.json({ error: "Guided assignment is not ready" }, { status: 409 });
      }
      const result = await recordCaseTaskOutcome(
        caseId,
        task.id,
        {
          requestId: `demo-${guest.sessionId}-${guest.generation}-signature-outcome`,
          expectedTaskUpdatedAt: task.updatedAt,
          outcome: parsed.data.outcome,
          note: fixedOutcomeNotes[parsed.data.outcome],
          searchScope: {
            repository: "Kin Resolve fictional demo archive",
            collection: "Mercer-March signature comparison",
            dateRange: "1907-1909"
          },
          actorId: `demo:${guest.sessionId}`,
          actorName: "Demo Guest"
        },
        { archiveId: guest.archiveId }
      );
      await recordPublicDemoEvent({ sessionId: guest.sessionId, eventName: "outcome_completed" });
      return NextResponse.json({
        task: result.task,
        next: "hypothesis_decision",
        nextAssignment: {
          title: "Check the bounded Northstar Cove departure ledger",
          summary: "Look for Mercer, March, and damaged M— surname variants in the fictional April–May 1907 pages."
        }
      });
    }

    const hypothesis = researchCase.hypotheses.find((candidate) => candidate.id === guidedHypothesisId);
    if (!hypothesis?.updatedAt) {
      return NextResponse.json({ error: "Guided hypothesis is not ready" }, { status: 409 });
    }
    const result = await updateCaseHypothesis(
      caseId,
      hypothesis.id,
      {
        requestId: `demo-${guest.sessionId}-${guest.generation}-signature-decision`,
        expectedUpdatedAt: hypothesis.updatedAt,
        status: parsed.data.decision,
        reason: fixedDecisionReasons[parsed.data.decision],
        actorId: `demo:${guest.sessionId}`,
        actorName: "Demo Guest"
      },
      { archiveId: guest.archiveId }
    );
    return NextResponse.json({ hypothesis: result.hypothesis, next: "case_next_steps" });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    }
    const detail = error instanceof Error ? error.message.toLowerCase() : "";
    if (/stale|conflict|idempot/.test(detail)) {
      return NextResponse.json({ error: "This demo record changed. Refresh and try again." }, { status: 409 });
    }
    await captureOperationalError({
      event: "api_error",
      requestId: guest.requestId,
      route: "/api/demo/cases/[caseId]/guide"
    }, error);
    return NextResponse.json({ error: "Unable to save the guided demo command" }, { status: 500 });
  }
});
