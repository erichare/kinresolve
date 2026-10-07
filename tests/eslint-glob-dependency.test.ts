import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pluginRequire = createRequire(require.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = pluginRequire("./utils/get-root-dirs.js") as {
  getRootDirs(context: { cwd: string; settings: { next?: { rootDir?: string | string[] } } }): string[];
};

describe("Next ESLint glob dependency", () => {
  let fixture = "";

  beforeAll(async () => {
    fixture = await mkdtemp(path.join(os.tmpdir(), "kinresolve-eslint-glob-"));
    await mkdir(path.join(fixture, "app"));
    await mkdir(path.join(fixture, "app", "pages"));
    await mkdir(path.join(fixture, "site"));
    await writeFile(path.join(fixture, "not-a-directory.txt"), "fixture");
  });

  afterAll(async () => {
    if (fixture) await rm(fixture, { recursive: true, force: true });
  });

  it.each(["package-lock.json", "site/package-lock.json"])(
    "keeps the vulnerable braces chain out of %s",
    async (file) => {
      const lock = JSON.parse(await readFile(path.join(process.cwd(), file), "utf8")) as {
        packages: Record<string, { name?: string; resolved?: string }>;
      };
      expect(Object.keys(lock.packages).filter((name) => /node_modules\/(?:braces|micromatch)$/.test(name)))
        .toEqual([]);
      const globPackages = Object.entries(lock.packages).filter(([name]) => /node_modules\/fast-glob$/.test(name));
      expect(globPackages).not.toHaveLength(0);
      for (const [, dependency] of globPackages) {
        const name = dependency.name ?? lock.packages[dependency.resolved ?? ""]?.name;
        expect(name).toBe("@kinresolve/eslint-glob");
      }
    }
  );

  it("preserves the default project root", () => {
    expect(getRootDirs({ cwd: fixture, settings: {} })).toEqual([fixture]);
  });

  it.each(["*", "{app,site}"])("finds only directory roots for %s", (pattern) => {
    expect(getRootDirs({ cwd: fixture, settings: { next: { rootDir: `${fixture}/${pattern}` } } })
      .sort())
      .toEqual([path.join(fixture, "app"), path.join(fixture, "site")]);
  });

  it("supports arrays of roots and normalizes Windows separators", () => {
    const roots = [path.join(fixture, "app").replaceAll("/", "\\"), path.join(fixture, "site")];
    expect(getRootDirs({ cwd: fixture, settings: { next: { rootDir: roots } } })
      .sort())
      .toEqual([path.join(fixture, "app"), path.join(fixture, "site")]);
  });

  it("preserves relative root paths without adding descendant directories", () => {
    const relative = path.relative(process.cwd(), fixture).replaceAll(path.sep, "/");
    expect(getRootDirs({ cwd: fixture, settings: { next: { rootDir: `${relative}/*` } } }).sort())
      .toEqual([`${relative}/app`, `${relative}/site`]);
  });
});
