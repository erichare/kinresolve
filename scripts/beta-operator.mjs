#!/usr/bin/env node
import {
  BetaOperatorClientError,
  executeBetaOperatorCommand,
  formatBetaOperatorError,
  formatBetaOperatorSuccess,
  parseBetaOperatorCommand,
  readBetaOperatorConfig
} from "../lib/beta-operator-client.ts";

try {
  const command = parseBetaOperatorCommand(process.argv.slice(2));
  const config = readBetaOperatorConfig(process.env);
  const result = await executeBetaOperatorCommand(command, config);
  process.stdout.write(`${formatBetaOperatorSuccess(result)}\n`);
} catch (error) {
  process.stderr.write(`${formatBetaOperatorError(error)}\n`);
  process.exitCode = error instanceof BetaOperatorClientError
    && (error.code === "CONFIG_INVALID" || error.code === "USAGE")
    ? 2
    : 1;
}
