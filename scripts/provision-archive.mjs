#!/usr/bin/env node
// Plain-JavaScript launcher for operators and packaging tools; tsx executes the
// typechecked command implementation.
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["--import", "tsx", "scripts/provision-archive-command.ts", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", () => {
  console.error("Unable to start the Kin Resolve archive provisioning command.");
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
