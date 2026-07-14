import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Data Sources review workspace contract", () => {
  it("offers searchable grouped review without bulk-accepting conflicts or deletions", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/Search (?:proposed )?changes/i);
    expect(source).toMatch(/Remote-only changes/i);
    expect(source).toMatch(/Local-only changes/i);
    expect(source).toMatch(/Conflicts require a decision/i);
    expect(source).toMatch(/Remote deletions keep local records/i);
    expect(source).toMatch(/Accept all safe incoming changes/i);
    expect(source).toContain('change.classification === "remote_only"');
    expect(source).not.toMatch(/classification\s*!==\s*["']same["'][\s\S]{0,120}accept_incoming/);
  });

  it("applies with an idempotency key and exposes explicit rollback after success", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toContain('"Idempotency-Key"');
    expect(source).toMatch(/Apply reviewed changes/i);
    expect(source).toMatch(/Undo this refresh/i);
    expect(source).toContain("/rollback");
  });
});
