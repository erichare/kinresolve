import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("disabled public archive page boundary", () => {
  it.each([
    ["app/page.tsx", "publicDemoEnabled()"],
    ["app/people/page.tsx", "resolvePublicArchiveId()"],
    ["app/people/[slug]/page.tsx", "await params"],
    ["app/places/page.tsx", "resolvePublicArchiveId()"],
    ["app/stories/page.tsx", "return ("],
    ["app/kinresolve/page.tsx", "return ("]
  ] as const)("guards %s before route work", async (file, workMarker) => {
    const source = await readFile(file, "utf8");
    const guard = "if (!publicArchiveEnabled())";

    expect(source, file).toContain(guard);
    expect(source.indexOf(guard), file).toBeLessThan(source.indexOf(workMarker));
    expect(source, file).toContain("redirect(privateWorkspaceLoginPath)");
  });
});
