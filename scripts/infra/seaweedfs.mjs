#!/usr/bin/env node
// Private S3-compatible evidence store for local development: SeaweedFS 4.48 `weed mini`
// (native Windows binary; MinIO community is archived, see ADR-0001 §2.8).
//
//   node scripts/infra/seaweedfs.mjs install   download + verify weed.exe into .local/bin
//   node scripts/infra/seaweedfs.mjs start     run `weed mini` on 127.0.0.1 (S3 on :8333)
//   node scripts/infra/seaweedfs.mjs status    exit 0 when the S3 endpoint answers
//   node scripts/infra/seaweedfs.mjs check     private-bucket + presigned URL smoke test
//   node scripts/infra/seaweedfs.mjs stop
//
// Credentials come from COLLARA_S3_ACCESS_KEY / COLLARA_S3_SECRET_KEY (shell or .env). The server
// is never started without them: SeaweedFS without keys serves every bucket anonymously.
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  DOWNLOADS_DIR,
  IS_WINDOWS,
  LOCAL_DIR,
  env,
  extractZip,
  fail,
  fetchVerified,
  httpRequest,
  loadDotEnv,
  parseCommand,
  readJson,
  requireEnv,
  requireFromWorkspace,
  runningService,
  sha256File,
  sleep,
  spawnDetached,
  stopService,
  tailFile,
  tcpOpen,
  waitFor,
  writeJson,
} from "./lib.mjs";

const VERSION = "4.48";
// GitHub release asset digest of windows_amd64.zip (upstream .md5: 01b750286b6b15411be5e4e76e7831e6).
const ARCHIVE = {
  url: `https://github.com/seaweedfs/seaweedfs/releases/download/${VERSION}/windows_amd64.zip`,
  sha256: "fe90c04c0620ad1a1c756f86cd5e1443773f56a446688077a4bb5ec04c3cc874",
};
const BIN_DIR = join(LOCAL_DIR, "bin");
const WEED = join(BIN_DIR, "weed.exe");
const WEED_MARKER = join(BIN_DIR, "weed.version.json");
const STATE_DIR = join(LOCAL_DIR, "seaweedfs");
const FILES = {
  data: join(STATE_DIR, "data"),
  pid: join(STATE_DIR, "weed.pid.json"),
  log: join(STATE_DIR, "weed.log"),
};
const S3_PORT = 8333;

loadDotEnv();
const settings = () => ({
  endpoint: env("COLLARA_S3_ENDPOINT", `http://127.0.0.1:${S3_PORT}`),
  region: env("COLLARA_S3_REGION", "us-east-1"),
  bucket: env("COLLARA_S3_BUCKET", "collara-evidence"),
});

async function install() {
  if (!IS_WINDOWS) {
    fail("this script installs the Windows binary only. On Linux/macOS use infra/compose/compose.yaml (untested) or the SeaweedFS release for your OS.");
  }
  const marker = readJson(WEED_MARKER);
  if (marker?.version === VERSION && existsSync(WEED) && (await sha256File(WEED)) === marker.weedSha256) {
    console.log(`SeaweedFS ${VERSION} already installed: ${WEED}`);
    return;
  }
  const zip = await fetchVerified({ ...ARCHIVE, dest: join(DOWNLOADS_DIR, `seaweedfs-${VERSION}-windows_amd64.zip`) });
  const unpacked = join(DOWNLOADS_DIR, `seaweedfs-${VERSION}`);
  rmSync(unpacked, { recursive: true, force: true });
  extractZip(zip, unpacked);
  if (!existsSync(join(unpacked, "weed.exe"))) fail(`weed.exe not found in ${zip}`);
  mkdirSync(BIN_DIR, { recursive: true });
  copyFileSync(join(unpacked, "weed.exe"), WEED);
  rmSync(unpacked, { recursive: true, force: true });
  rmSync(zip, { force: true });
  writeJson(WEED_MARKER, { version: VERSION, archiveSha256: ARCHIVE.sha256, weedSha256: await sha256File(WEED) });
  console.log(`installed SeaweedFS ${VERSION}: ${WEED}`);
}

/** The S3 gateway answers GET /healthz with 200 without credentials. */
async function s3Healthy() {
  const response = await httpRequest(`http://127.0.0.1:${S3_PORT}/healthz`);
  return response?.status === 200;
}

async function start() {
  const { COLLARA_S3_ACCESS_KEY: accessKey, COLLARA_S3_SECRET_KEY: secretKey } = requireEnv([
    "COLLARA_S3_ACCESS_KEY",
    "COLLARA_S3_SECRET_KEY",
  ]);
  const { bucket } = settings();
  const running = runningService(FILES.pid, "weed.exe");
  if (running) {
    console.log(`SeaweedFS is already running (pid ${running.pid}); S3 endpoint http://127.0.0.1:${S3_PORT}`);
    return;
  }
  if (await tcpOpen("127.0.0.1", S3_PORT)) fail(`port ${S3_PORT} is already in use by another process`);
  await install();
  mkdirSync(FILES.data, { recursive: true });

  // Loopback only, no admin UI, and the WebDAV/Iceberg/Lance listeners off (Collara only uses S3).
  const args = [
    "mini",
    `-dir=${FILES.data}`,
    "-ip=127.0.0.1",
    "-ip.bind=127.0.0.1",
    `-bucket=${bucket}`,
    "-admin.ui=false",
    "-webdav=false",
    "-s3.port.iceberg=0",
    "-s3.port.lance=0",
  ];
  const launch = () => {
    const child = spawnDetached(WEED, args, {
      logFile: FILES.log,
      cwd: STATE_DIR,
      // weed mini creates its admin S3 identity from these variables.
      env: { ...process.env, AWS_ACCESS_KEY_ID: accessKey, AWS_SECRET_ACCESS_KEY: secretKey },
    });
    writeJson(FILES.pid, { pid: child.pid, startedAt: new Date().toISOString(), version: VERSION, args });
    return child;
  };
  let child = launch();
  let ready = await waitFor(s3Healthy, { timeoutMs: 60_000, intervalMs: 500, abort: child.exited });
  // Seen on Windows right after a restart: the master panics because renaming its raft conf file
  // fails with "Access is denied" (a transient file lock). One retry has been enough.
  if (!ready && child.exited() && /Access is denied/.test(tailFile(FILES.log, 200))) {
    console.log("weed exited with a transient Windows file lock; retrying once");
    await sleep(2000);
    child = launch();
    ready = await waitFor(s3Healthy, { timeoutMs: 60_000, intervalMs: 500, abort: child.exited });
  }
  if (!ready) {
    await stopService(FILES.pid, "weed.exe", "SeaweedFS", { ports: [S3_PORT] });
    fail(`SeaweedFS did not start (exit code ${child.exitCode() ?? "n/a"}). Last log lines:\n${tailFile(FILES.log)}`);
  }
  console.log(`SeaweedFS ${VERSION} running (pid ${child.pid})`);
  console.log(`  S3 endpoint  http://127.0.0.1:${S3_PORT}  bucket ${bucket}  (path-style, region ${settings().region})`);
  console.log(`  data         ${FILES.data}`);
  console.log(`  log          ${FILES.log}`);
}

async function status() {
  const running = runningService(FILES.pid, "weed.exe");
  const healthy = await s3Healthy();
  console.log(`process   ${running ? `running (pid ${running.pid}, since ${running.startedAt})` : "not running"}`);
  console.log(`S3 :${S3_PORT}  ${healthy ? "healthy (GET /healthz 200)" : "not reachable"}`);
  if (!running || !healthy) process.exitCode = 1;
}

/** Smoke test with the AWS SDK installed in apps/api. Uploads and deletes one object under _smoke/. */
async function check() {
  const { COLLARA_S3_ACCESS_KEY: accessKeyId, COLLARA_S3_SECRET_KEY: secretAccessKey } = requireEnv([
    "COLLARA_S3_ACCESS_KEY",
    "COLLARA_S3_SECRET_KEY",
  ]);
  const s3 = requireFromWorkspace("apps/api", "@aws-sdk/client-s3");
  const presigner = requireFromWorkspace("apps/api", "@aws-sdk/s3-request-presigner");
  if (!s3 || !presigner) fail("@aws-sdk/client-s3 is not installed in apps/api; run `pnpm install` first.");
  const { endpoint, region, bucket } = settings();
  const client = new s3.S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const key = `_smoke/${randomUUID()}.txt`;
  const body = `collara seaweedfs smoke ${new Date().toISOString()}`;
  const objectUrl = `${endpoint}/${bucket}/${key}`;
  const results = [];
  const record = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  };

  try {
    await client.send(new s3.HeadBucketCommand({ Bucket: bucket }));
    record(`bucket ${bucket} exists`, true);
    await client.send(new s3.PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "text/plain" }));
    record("authenticated PutObject", true);

    const anonymousGet = await httpRequest(objectUrl);
    record("anonymous GET object is denied", anonymousGet?.status === 403, `HTTP ${anonymousGet?.status ?? "unreachable"}`);
    const anonymousList = await httpRequest(`${endpoint}/${bucket}`);
    record("anonymous list bucket is denied", anonymousList?.status === 403, `HTTP ${anonymousList?.status ?? "unreachable"}`);

    const getUrl = await presigner.getSignedUrl(client, new s3.GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
    const presignedGet = await httpRequest(getUrl);
    record("presigned GET (60 s)", presignedGet?.status === 200 && presignedGet.text === body, `HTTP ${presignedGet?.status ?? "unreachable"}`);

    const putKey = `${key}.put`;
    const putUrl = await presigner.getSignedUrl(client, new s3.PutObjectCommand({ Bucket: bucket, Key: putKey }), { expiresIn: 60 });
    const presignedPut = await httpRequest(putUrl, { method: "PUT", body: "presigned put" });
    record("presigned PUT (60 s)", presignedPut?.status === 200, `HTTP ${presignedPut?.status ?? "unreachable"}`);

    const tampered = await httpRequest(getUrl.replace(/X-Amz-Signature=[0-9a-f]+/, `X-Amz-Signature=${"0".repeat(64)}`));
    record("presigned GET with a bad signature is denied", tampered?.status === 403, `HTTP ${tampered?.status ?? "unreachable"}`);

    try {
      await client.send(new s3.GetBucketPolicyCommand({ Bucket: bucket }));
      record("bucket has no public policy", false, "a bucket policy exists");
    } catch (error) {
      record("bucket has no public policy", error.name === "NoSuchBucketPolicy", error.name);
    }

    await client.send(new s3.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    await client.send(new s3.DeleteObjectCommand({ Bucket: bucket, Key: putKey }));
    record("cleanup", true);
  } catch (error) {
    const status = error.$metadata?.httpStatusCode;
    record("S3 request", false, `${error.name}${status ? ` HTTP ${status}` : ""}: ${error.message}`);
  }
  if (results.includes(false)) process.exitCode = 1;
}

const { command } = parseCommand(process.argv.slice(2), ["install", "start", "stop", "status", "check"], "status");
const actions = {
  install,
  start,
  status,
  check,
  stop: () => stopService(FILES.pid, "weed.exe", "SeaweedFS", { ports: [S3_PORT] }),
};
await actions[command]();
