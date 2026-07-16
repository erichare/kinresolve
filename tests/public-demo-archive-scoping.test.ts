import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Violation = {
  file: string;
  line: number;
  call: string;
};

describe("private workspace archive scoping", () => {
  it("requires every private readWorkspace call to carry an explicit archive scope", async () => {
    const privateRoot = path.join(process.cwd(), "app", "app");
    const files = await typescriptFiles(privateRoot);
    const violations = (
      await Promise.all(files.map((file) => findUnscopedWorkspaceReads(file)))
    ).flat();

    expect(violations, formatViolations(violations)).toEqual([]);
  });
});

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(target);
    return /\.tsx?$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat().sort();
}

async function findUnscopedWorkspaceReads(file: string): Promise<Violation[]> {
  const sourceText = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "readWorkspace"
      && (node.arguments.length !== 1 || !isExplicitArchiveScope(node.arguments[0]))
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        file: path.relative(process.cwd(), file),
        line: position.line + 1,
        call: node.getText(sourceFile)
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function isExplicitArchiveScope(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return true;
  if (ts.isParenthesizedExpression(expression)) return isExplicitArchiveScope(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return isExplicitArchiveScope(expression.whenTrue) && isExplicitArchiveScope(expression.whenFalse);
  }
  if (!ts.isObjectLiteralExpression(expression)) return false;

  return expression.properties.some((property) =>
    ts.isPropertyAssignment(property)
    && (
      (ts.isIdentifier(property.name) && property.name.text === "archiveId")
      || (ts.isStringLiteral(property.name) && property.name.text === "archiveId")
    )
  );
}

function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return "All private workspace reads are explicitly archive-scoped.";
  return [
    "Private workspace reads must be explicitly archive-scoped:",
    ...violations.map((violation) =>
      `${violation.file}:${violation.line} ${violation.call}`
    )
  ].join("\n");
}
