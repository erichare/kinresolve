import path from "node:path";

export const staticHoldingHeaders = Object.freeze({
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
});

export const staticHoldingBuildConfig = Object.freeze({
  version: 3,
  routes: [
    {
      src: "^/.*$",
      headers: staticHoldingHeaders,
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

export const staticHoldingOutputFiles = Object.freeze([
  "config.json",
  "static/login.html"
]);

export function serializeStaticHoldingConfig() {
  return `${JSON.stringify(staticHoldingBuildConfig, null, 2)}\n`;
}

export function resolveStaticHoldingOutput(argv, workingDirectory = process.cwd()) {
  let requested = ".vercel/output";
  if (argv.length !== 0) {
    if (argv.length !== 2 || argv[0] !== "--output" || !argv[1]?.trim()) {
      throw new Error("Usage: <script> [--output <directory>].");
    }
    requested = argv[1];
  }

  const resolved = path.resolve(workingDirectory, requested);
  if (
    resolved === path.parse(resolved).root
    || resolved === path.resolve(workingDirectory)
    || path.basename(resolved) !== "output"
  ) {
    throw new Error("The static holding output directory is unsafe.");
  }
  return resolved;
}
