#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

try {
  const [operation, key, localPath, fourth, fifth, ...unexpected] = process.argv.slice(2);
  const upload = operation === "upload";
  const download = operation === "download";
  const expectedSha256 = download ? fourth : undefined;
  const outputPath = upload ? fourth : fifth;
  if (
    (!upload && !download)
    || !key
    || !localPath
    || !outputPath
    || unexpected.length > 0
    || (upload && fifth)
    || (download && !expectedSha256)
  ) {
    throw new Error(
      "Usage: recovery-offsite.mjs upload <key> <local-file> <output.json> OR download <key> <local-file> <expected-sha256> <output.json>."
    );
  }
  if (!/^production-recovery\/[a-f0-9]{40}\/[0-9]+-[0-9]+\/(?:database\.dump|objects\.tar)\.age$/.test(key)) {
    throw new Error("The offsite recovery object key is not release- and run-bound.");
  }
  const bucket = required("RECOVERY_BACKUP_S3_BUCKET");
  const region = required("RECOVERY_BACKUP_S3_REGION");
  const accessKeyId = required("RECOVERY_BACKUP_S3_ACCESS_KEY_ID");
  const secretAccessKey = required("RECOVERY_BACKUP_S3_SECRET_ACCESS_KEY");
  const endpoint = process.env.RECOVERY_BACKUP_S3_ENDPOINT?.trim();
  if (endpoint && new URL(endpoint).protocol !== "https:") {
    throw new Error("RECOVERY_BACKUP_S3_ENDPOINT must use HTTPS.");
  }
  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId, secretAccessKey }
  });

  if (upload) {
    const metadata = await stat(localPath);
    if (!metadata.isFile() || metadata.size <= 0) throw new Error("The encrypted recovery backup is missing or empty.");
    const sha256 = await fileSha256(localPath);
    const checksum = Buffer.from(sha256, "hex").toString("base64");
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentLength: metadata.size,
      ContentType: "application/octet-stream",
      CacheControl: "private, no-store",
      IfNoneMatch: "*",
      ChecksumSHA256: checksum,
      ServerSideEncryption: "AES256"
    }));
    await assertHead(client, bucket, key, metadata.size, checksum);
    await privateJson(outputPath, {
      operation: "upload",
      sha256,
      size: metadata.size,
      completedAt: new Date().toISOString()
    });
    console.log("Uploaded and provider-verified an encrypted offsite recovery backup.");
  } else {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("The expected offsite backup digest is invalid.");
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }));
    if (!response.Body?.transformToByteArray) throw new Error("The offsite recovery backup body is unreadable.");
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expectedSha256) throw new Error("The downloaded offsite recovery backup digest does not match.");
    const checksum = Buffer.from(expectedSha256, "hex").toString("base64");
    if (response.ChecksumSHA256 !== checksum) throw new Error("The provider checksum for the downloaded backup is missing or wrong.");
    await writeFile(localPath, bytes, { flag: "wx", mode: 0o600 });
    await chmod(localPath, 0o600);
    await privateJson(outputPath, {
      operation: "download",
      sha256: actual,
      size: bytes.length,
      completedAt: new Date().toISOString()
    });
    console.log("Downloaded and checksum-verified an encrypted offsite recovery backup.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Offsite recovery backup operation failed.");
  process.exitCode = 1;
}

async function assertHead(client, bucket, key, size, checksum) {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }));
  if (head.ContentLength !== size || head.ChecksumSHA256 !== checksum) {
    throw new Error("The provider did not attest the uploaded backup size and SHA-256 checksum.");
  }
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function privateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
