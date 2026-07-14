import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("stable release migration history", () => {
  it("checks out full history so immutable release anchors can be verified", async () => {
    const workflow = await readFile(path.join(process.cwd(), ".github", "workflows", "vercel-release.yml"), "utf8");

    expect(workflow).toMatch(/fetch-depth:\s*0/);
  });
});
