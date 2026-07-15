import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(siteRoot, "..", "openapi", "kinresolve-v1.yaml");
const destination = resolve(siteRoot, "public", "openapi", "kinresolve-v1.yaml");

const document = readFileSync(source, "utf8");
if (!document.startsWith("openapi: 3.1.0\n")) {
  throw new Error("The canonical Kin Resolve API document is not OpenAPI 3.1.0.");
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log("Published the canonical API v1 OpenAPI document into the static site.");
