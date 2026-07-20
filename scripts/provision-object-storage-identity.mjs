#!/usr/bin/env node
import { randomBytes } from "node:crypto";

import { readArchiveIdSetting } from "../lib/environment-aliases.ts";
import { createConfiguredArchiveObjectStorage } from "../lib/storage/object-storage.ts";

const archiveId = readArchiveIdSetting()?.trim();
if (!archiveId || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(archiveId)) {
  console.error(
    "KINRESOLVE_ARCHIVE_ID (or legacy KINSLEUTH_ARCHIVE_ID) is required and must be a safe release-cell archive ID."
  );
  process.exit(1);
}

try {
  const storage = createConfiguredArchiveObjectStorage();
  const result = await storage.put({
    archiveId,
    purpose: "release-readiness",
    fileName: "identity-sentinel.bin",
    bytes: randomBytes(64),
    contentType: "application/octet-stream"
  });
  console.log(result.sha256);
} catch {
  console.error("Unable to provision the private object-storage identity sentinel.");
  process.exitCode = 1;
}
