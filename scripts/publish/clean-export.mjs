#!/usr/bin/env node
// Prepares a clean public snapshot of the repository WITHOUT touching it: copies the tracked files of HEAD into a new
// directory, leaving out the third-party reference capture (and anything else you pass with --exclude), then checks
// the result. It never rewrites history, never pushes and never changes repository visibility; creating the public
// repository from the output is a manual, owner-approved step (docs/publication.md).
//
//   node scripts/publish/clean-export.mjs [--out <dir>] [--exclude <path-prefix-or-glob>]... [--init]
//
// - Default exclusion: Collara Website/uploads/web-capture-*.json (a DOM/CSS capture of linear.app and demo.mercury.com).
// - --init also runs `git init` in the output and makes ONE commit with your configured git identity (no co-author
//   trailers are added); the snapshot has no history.
// - If gitleaks is on PATH (or GITLEAKS_BIN is set) the output is scanned; otherwise the command to run is printed.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { values } = parseArgs({
  options: { out: { type: "string" }, exclude: { type: "string", multiple: true, default: [] }, init: { type: "boolean", default: false } },
});
const out = resolve(values.out ?? join(ROOT, ".local", "publish", "collara-public"));
const DEFAULT_EXCLUDES = ["Collara Website/uploads/web-capture-*.json"];
const excludes = [...DEFAULT_EXCLUDES, ...values.exclude];

function git(args, options = {}) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/** `*` matches within a path segment; a trailing `/` (or no wildcard) matches a prefix. */
function matcher(pattern) {
  if (!pattern.includes("*")) return (file) => file === pattern || file.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`);
  const source = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  const regex = new RegExp(`^${source}$`);
  return (file) => regex.test(file);
}
const isExcluded = (file) => excludes.map(matcher).some((test) => test(file));

if (git(["status", "--porcelain"]).trim()) console.warn("warning: the working tree has uncommitted changes; the snapshot is built from HEAD only.");
if (existsSync(out)) {
  if (readdirSync(out).length > 0) {
    console.error(`error: ${out} already exists and is not empty. Remove it or pass another --out.`);
    process.exit(2);
  }
} else {
  mkdirSync(out, { recursive: true });
}

const head = git(["rev-parse", "HEAD"]).trim();
const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const kept = tracked.filter((file) => !isExcluded(file));
const dropped = tracked.filter(isExcluded);
for (const file of kept) {
  const target = join(out, file);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(ROOT, file), target);
}
console.log(`snapshot of ${head.slice(0, 7)}: ${kept.length} files written to ${out}`);
console.log(`excluded (${dropped.length}):`);
for (const file of dropped) console.log(`  ${file}`);

// Checks on the output.
const problems = [];
const present = (file) => existsSync(join(out, file));
for (const file of dropped) if (present(file)) problems.push(`excluded file is present: ${file}`);
for (const required of ["README.md", "LICENSE", "package.json"]) if (!present(required)) console.warn(`warning: ${required} is not in the snapshot`);
if (present(".env") || present(".env.devnet") || present(".local")) problems.push("an env file or .local/ is in the snapshot (it should be git-ignored)");
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}
const files = walk(out);
const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`size: ${(bytes / 1024 / 1024).toFixed(1)} MB in ${files.length} files`);
const large = files.filter((file) => statSync(file).size > 5 * 1024 * 1024);
for (const file of large) problems.push(`large file (>5 MB): ${file.slice(out.length + 1)}`);
// Third-party hostnames left in text files outside the research notes (a capture would show up here).
const capturePattern = /linear\.app|demo\.mercury\.com/;
const capturedIn = files.filter((file) => /\.(json|html)$/.test(file) && statSync(file).size > 200_000 && capturePattern.test(readFileSync(file, "utf8").slice(0, 200_000)));
for (const file of capturedIn) problems.push(`looks like a third-party capture: ${file.slice(out.length + 1)}`);

// Findings reviewed on 2026-10-09 (docs/security/secret-audit-2026-10-04.md): none carries a secret value. Anything else is a problem.
const REVIEWED = [
  { rule: "generic-api-key", file: "apps/api/test/localnet/cases.it.test.ts", why: "idempotencyKey labels in tests" },
  { rule: "generic-api-key", file: "apps/api/test/localnet/dealer-consent.it.test.ts", why: "idempotencyKey labels in tests" },
  { rule: "generic-api-key", file: "apps/worker/src/jobs/handlers/export.ts", why: "reads COLLARA_S3_SECRET_KEY from the environment, no value" },
  { rule: "generic-api-key", file: "docs/_research/research-canton.md", why: "a contractKeyHash from a throwaway local sandbox" },
  { rule: "generic-api-key", file: "docs/security/secret-audit-2026-10-04.md", why: "quotes the variable name above, no value" },
  { rule: "generic-api-key", file: "render.yaml", why: "a YAML field called key that names the bucket variable; no value" },
];
const gitleaks = process.env.GITLEAKS_BIN ?? "gitleaks";
const reportPath = join(tmpdir(), `collara-gitleaks-${process.pid}.json`);
const scan = spawnSync(gitleaks, ["dir", out, "--no-banner", "--redact", "--report-format", "json", "--report-path", reportPath, "--exit-code", "7"], { encoding: "utf8" });
if (scan.error) {
  console.log(`secret scan: gitleaks not found; run it yourself:  gitleaks dir "${out}" --redact`);
} else if (scan.status === 0) {
  console.log("secret scan: gitleaks found nothing in the snapshot");
} else if (scan.status !== 7 || !existsSync(reportPath)) {
  problems.push(`gitleaks failed (exit ${scan.status}): ${(scan.stdout + scan.stderr).slice(0, 500)}`);
} else {
  const findings = JSON.parse(readFileSync(reportPath, "utf8"));
  const relative = (file) => file.slice(out.length + 1).split("\\").join("/");
  const unreviewed = findings.filter((finding) => !REVIEWED.some((r) => r.rule === finding.RuleID && r.file === relative(finding.File)));
  console.log(`secret scan: ${findings.length} gitleaks finding(s), ${findings.length - unreviewed.length} already reviewed as false positives, ${unreviewed.length} not reviewed`);
  for (const finding of unreviewed) problems.push(`gitleaks ${finding.RuleID}: ${relative(finding.File)}:${finding.StartLine} (value redacted)`);
}
rmSync(reportPath, { force: true });

if (problems.length) {
  console.error("\nPROBLEMS:");
  for (const problem of problems) console.error(`  - ${problem}`);
  rmSync(join(out, ".git"), { recursive: true, force: true });
  process.exit(1);
}

if (values.init) {
  git(["init", "-q", "-b", "main"], { cwd: out });
  git(["add", "-A"], { cwd: out });
  const message = `Collara public snapshot of ${head.slice(0, 7)}\n\nCopy of the tracked tree without the third-party reference capture. No history.`;
  git(["commit", "-q", "-m", message], { cwd: out });
  console.log("created one commit in the output (your configured git identity; no co-author trailer).");
}
console.log("\nNothing was pushed and no repository was created or changed. Next: docs/publication.md (create the public repository, push, then check the links in a private window).");
