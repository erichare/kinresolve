type HeaderMap = ReadonlyMap<string, readonly string[]>;

export type ApiEdgeResponseHeaderPolicy =
  | "ordinary"
  | "rate-limited"
  | "direct-protection"
  | "canonical";

const statusLinePattern = /^HTTP\/(?:[0-9]+(?:\.[0-9]+)?) [1-5][0-9]{2}(?:[ \t].*)?$/i;
const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const tokenPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const parameterValuePattern = /^(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\t !#-\[\]-~]|\\[\t -~])*")$/;

export function validateApiEdgeResponseHeaders(
  rawHeaders: string,
  policy: ApiEdgeResponseHeaderPolicy
): void {
  const headers = parseLastCurlHeaderBlock(rawHeaders);

  if (policy === "ordinary") {
    requireMediaType(headers, "application/json");
    const directives = cacheControlDirectives(headers, true);
    if (!directives.has("private") || !directives.has("no-store")) {
      throw new Error("The ordinary API response is not explicitly private and no-store.");
    }
  } else if (policy === "rate-limited") {
    const directives = cacheControlDirectives(headers, false);
    if (
      directives.size > 0
      && !directives.has("private")
      && !directives.has("no-store")
      && !directives.has("no-cache")
      && directives.get("max-age") !== "0"
    ) {
      throw new Error("The rate-limited response advertises no safe cache directive.");
    }
  } else if (policy === "direct-protection") {
    requireMediaType(headers, "text/html");
  }

  if (policy !== "direct-protection") {
    if (headers.has("set-cookie") || headers.has("location")) {
      throw new Error("A canonical API response contains a stateful or redirect header.");
    }
  }
  const directives = cacheControlDirectives(headers, false);
  if (
    directives.has("public")
    || directives.has("s-maxage")
    || (directives.has("max-age") && directives.get("max-age") !== "0")
  ) {
    throw new Error("An API edge response advertises positive shared-cache freshness.");
  }
}

function parseLastCurlHeaderBlock(rawHeaders: string): HeaderMap {
  if (
    typeof rawHeaders !== "string"
    || Buffer.byteLength(rawHeaders, "utf8") < 1
    || Buffer.byteLength(rawHeaders, "utf8") > 16_384
    || rawHeaders.includes("\0")
  ) {
    throw new Error("The response header block is invalid.");
  }

  const blocks: Array<Map<string, string[]>> = [];
  let current: Map<string, string[]> | undefined;
  for (const line of rawHeaders.split(/\r?\n/u)) {
    if (statusLinePattern.test(line)) {
      current = new Map<string, string[]>();
      blocks.push(current);
      continue;
    }
    if (!current || line.length === 0) continue;
    if (/^[ \t]/u.test(line)) {
      throw new Error("Folded response headers are not accepted.");
    }
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error("A response header line is malformed.");
    const name = line.slice(0, separator);
    if (!headerNamePattern.test(name)) throw new Error("A response header name is malformed.");
    const value = line.slice(separator + 1).trim();
    const normalizedName = name.toLowerCase();
    const values = current.get(normalizedName) ?? [];
    values.push(value);
    current.set(normalizedName, values);
  }

  const last = blocks.at(-1);
  if (!last) throw new Error("The response header status line is missing.");
  return last;
}

function requireMediaType(headers: HeaderMap, expected: string): void {
  const values = headers.get("content-type");
  if (!values || values.length !== 1) {
    throw new Error("The response must contain exactly one Content-Type header.");
  }
  const segments = values[0]!.split(";").map((value) => value.trim());
  if (segments.shift()?.toLowerCase() !== expected) {
    throw new Error("The response media type is invalid.");
  }
  for (const parameter of segments) {
    const separator = parameter.indexOf("=");
    if (separator < 1) throw new Error("A response media-type parameter is malformed.");
    const name = parameter.slice(0, separator).trim();
    const value = parameter.slice(separator + 1).trim();
    if (!tokenPattern.test(name) || !parameterValuePattern.test(value)) {
      throw new Error("A response media-type parameter is malformed.");
    }
  }
}

function cacheControlDirectives(headers: HeaderMap, required: boolean): Map<string, string | true> {
  const values = headers.get("cache-control");
  if (!values) {
    if (required) throw new Error("The response Cache-Control header is missing.");
    return new Map();
  }
  const directives = new Map<string, string | true>();
  for (const rawDirective of values.join(",").split(",")) {
    const directive = rawDirective.trim();
    if (!directive) throw new Error("A Cache-Control directive is malformed.");
    const separator = directive.indexOf("=");
    const rawName = separator < 0 ? directive : directive.slice(0, separator).trim();
    const rawValue = separator < 0 ? undefined : directive.slice(separator + 1).trim();
    const name = rawName.toLowerCase();
    if (
      !tokenPattern.test(rawName)
      || directives.has(name)
      || (rawValue !== undefined && !parameterValuePattern.test(rawValue))
    ) {
      throw new Error("A Cache-Control directive is malformed or duplicated.");
    }
    directives.set(name, rawValue === undefined ? true : unquote(rawValue));
  }
  return directives;
}

function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  return value.slice(1, -1).replace(/\\([\t -~])/gu, "$1");
}
