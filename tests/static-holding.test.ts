import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validatePrivateReleaseHeaders } from "@/lib/release-smoke";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("static private-beta holding artifact", () => {
  it("builds the same minimal Vercel Build Output API tree every time", async () => {
    const root = await scratchDirectory();
    const first = path.join(root, "first", "output");
    const second = path.join(root, "second", "output");

    expect(runBuilder(first)).toMatchObject({ status: 0, stderr: "" });
    expect(runBuilder(second)).toMatchObject({ status: 0, stderr: "" });

    const firstTree = await readTree(first);
    const secondTree = await readTree(second);
    expect([...firstTree.keys()]).toEqual([
      "config.json",
      "static/login.html"
    ]);
    expect(secondTree).toEqual(firstTree);
    expect([...firstTree.keys()].some((name) => name.includes(".func"))).toBe(false);
  });

  it("serves only the holding page and deliberate static 404 responses", async () => {
    const root = await scratchDirectory();
    const output = path.join(root, "output");
    expect(runBuilder(output).status).toBe(0);

    const config = JSON.parse(await readFile(path.join(output, "config.json"), "utf8")) as {
      version: number;
      routes: Array<Record<string, unknown>>;
    };
    expect(config).toEqual({
      version: 3,
      routes: [
        {
          src: "^/.*$",
          headers: expectedHeaders(),
          continue: true
        },
        {
          src: "^/api/health/?$",
          status: 404
        },
        {
          src: "^/login/?$",
          methods: ["GET", "HEAD"],
          dest: "/login.html"
        },
        {
          src: "^/?$",
          methods: ["GET", "HEAD"],
          dest: "/login.html"
        },
        {
          src: "^/.*$",
          status: 404
        }
      ]
    });

    const headers = new Headers(config.routes[0].headers as Record<string, string>);
    expect(() => validatePrivateReleaseHeaders(headers)).not.toThrow();
    expect(headers.get("cache-control")).toBe("no-store, max-age=0");

    const html = await readFile(path.join(output, "static", "login.html"), "utf8");
    expect(html).toMatch(/Kin Resolve/);
    expect(html).toMatch(/private beta/i);
    expect(html).toMatch(/name="robots" content="noindex, nofollow, noarchive"/);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("verifies the exact output and fails closed on an added runtime artifact", async () => {
    const root = await scratchDirectory();
    const output = path.join(root, "output");
    expect(runBuilder(output).status).toBe(0);
    expect(runVerifier(output)).toMatchObject({ status: 0, stderr: "" });

    const functionDirectory = path.join(output, "functions", "unexpected.func");
    await mkdir(functionDirectory, { recursive: true });
    await writeFile(path.join(functionDirectory, "index.js"), "export default function runtime() {}\n", "utf8");

    const rejected = runVerifier(output);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toMatch(/unexpected output|static holding/i);
  });

  it("refuses to recursively replace a directory not explicitly named output", async () => {
    const root = await scratchDirectory();
    const unsafeDirectory = path.join(root, "must-survive");
    const sentinel = path.join(unsafeDirectory, "sentinel.txt");
    await mkdir(unsafeDirectory);
    await writeFile(sentinel, "preserve me\n", "utf8");

    const result = runBuilder(unsafeDirectory);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unsafe/i);
    expect(await readFile(sentinel, "utf8")).toBe("preserve me\n");
  });
});

async function scratchDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-static-holding-"));
  scratchDirectories.push(directory);
  return directory;
}

function runBuilder(output: string) {
  return runScript("scripts/build-static-holding.mjs", output);
}

function runVerifier(output: string) {
  return runScript("scripts/verify-static-holding.mjs", output);
}

function runScript(script: string, output: string) {
  return spawnSync(process.execPath, [script, "--output", output], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

async function readTree(root: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  await visit("");
  return entries;

  async function visit(relativeDirectory: string): Promise<void> {
    const directory = path.join(root, relativeDirectory);
    const children = (await import("node:fs/promises")).readdir(directory, { withFileTypes: true });
    for (const child of (await children).sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = path.posix.join(relativeDirectory, child.name);
      if (child.isDirectory()) {
        await visit(relativePath);
      } else {
        expect(child.isFile(), relativePath).toBe(true);
        entries.set(relativePath, (await readFile(path.join(root, relativePath))).toString("hex"));
      }
    }
  }
}

function expectedHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive"
  };
}
