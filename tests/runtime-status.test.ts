import { afterEach, describe, expect, it } from "vitest";
import { getAIStatus, getRuntimeStatus } from "@/lib/runtime-status";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("runtime status", () => {
  it("reports AI provider defaults and API key presence", () => {
    delete process.env.AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_API_MODE;

    expect(getAIStatus()).toMatchObject({
      configured: false,
      baseUrl: "https://api.openai.com/v1",
      chatModel: "gpt-5-mini",
      embeddingModel: "text-embedding-3-small",
      mode: "responses"
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.AI_API_MODE = "chat";

    expect(getAIStatus()).toMatchObject({
      configured: true,
      mode: "chat"
    });
  });

  it("reports a degraded database state when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    const status = await getRuntimeStatus();

    expect(status.database).toMatchObject({
      configured: false,
      connected: false,
      archiveId: "archive-default",
      error: "DATABASE_URL is not configured"
    });
  });
});
