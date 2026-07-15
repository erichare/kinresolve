import SwaggerParser from "@apidevtools/swagger-parser";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { apiV1RouteDefinitions } from "../lib/api-v1-contract.ts";

const specificationPath = resolve("openapi/kinresolve-v1.yaml");
const document = await SwaggerParser.validate(specificationPath);

if (document.openapi !== "3.1.0") {
  throw new Error(`Expected OpenAPI 3.1.0, received ${document.openapi ?? "no version"}.`);
}

const server = document.servers?.[0]?.url;
if (server !== "https://app.kinresolve.com/api/v1") {
  throw new Error(`Unexpected API server: ${server ?? "missing"}.`);
}

const documented = [];
const supportedMethods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
for (const [relativePath, pathItem] of Object.entries(document.paths ?? {})) {
  if (!pathItem || typeof pathItem !== "object") continue;
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!supportedMethods.has(method.toLowerCase())) continue;
    if (method.toLowerCase() !== "get") {
      throw new Error(`The read-only v1 contract cannot document ${method.toUpperCase()} ${relativePath}.`);
    }
    const runtimePath = `/api/v1${relativePath}`.replaceAll("{id}", "[id]");
    documented.push({
      path: runtimePath,
      operationId: operation.operationId,
      scope: operation["x-kinresolve-scope"],
      rateLimitProfile: operation["x-kinresolve-rate-limit-profile"]
    });
  }
}

const expected = apiV1RouteDefinitions.map(({ path, operationId, scope, rateLimitProfile }) => ({
  path,
  operationId,
  scope,
  rateLimitProfile
}));
const sortOperations = (operations) => operations.toSorted((left, right) => left.path.localeCompare(right.path));
if (JSON.stringify(sortOperations(documented)) !== JSON.stringify(sortOperations(expected))) {
  throw new Error(
    `OpenAPI operations do not match the runtime registry.\nDocumented: ${JSON.stringify(sortOperations(documented))}\nRuntime: ${JSON.stringify(sortOperations(expected))}`
  );
}

const source = await readFile(specificationPath, "utf8");
if (/Authorization:\s*Bearer\s+(?!\$KINRESOLVE_TOKEN)/i.test(source)) {
  throw new Error("OpenAPI examples must use Authorization: Bearer $KINRESOLVE_TOKEN.");
}
if (/kr_beta_[A-Za-z0-9_-]{12,}/.test(source)) {
  throw new Error("OpenAPI must not contain a token-shaped example value.");
}

console.log(`Validated OpenAPI 3.1 contract with ${documented.length} registered GET operations.`);
