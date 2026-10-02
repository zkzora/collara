#!/usr/bin/env node
// Verifies the vendored DM DARs, builds every Collara Daml package and runs the Daml Script tests.
// Usage (any shell): node daml/collara/check.mjs [--skip-build]
// Needs dpm (SDK 3.5.12) on PATH, in $DPM, or at %APPDATA%\dpm\bin\dpm.cmd, and Java 17+.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';

function resolveDpm() {
  if (process.env.DPM) return process.env.DPM;
  const appDataShim = process.env.APPDATA && join(process.env.APPDATA, 'dpm', 'bin', 'dpm.cmd');
  if (isWindows && appDataShim && existsSync(appDataShim)) return appDataShim;
  return 'dpm';
}

function verifyChecksums() {
  const dir = join(root, 'vendor-dars');
  const lines = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').split('\n').filter((l) => l.trim() !== '');
  for (const line of lines) {
    const [expected, rawName] = line.trim().split(/\s+/);
    const name = rawName.replace(/^\*/, '');
    const actual = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');
    if (actual !== expected) throw new Error(`Checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
    console.log(`checksum ok  ${name}`);
  }
}

function run(dpm, args, cwd) {
  const env = { ...process.env, JDK_JAVA_OPTIONS: process.env.JDK_JAVA_OPTIONS ?? '-Xmx1g' };
  // .cmd shims need a shell on Windows; quote the command in case the path contains spaces.
  const command = isWindows ? `"${dpm}"` : dpm;
  const result = spawnSync(command, args, { cwd, env, shell: isWindows, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function runTests(dpm, pkg) {
  const { status, output } = run(dpm, ['test'], join(root, pkg));
  const results = output.split(/\r?\n/).filter((l) => /^daml\/.*: (ok|failed)/.test(l));
  const failed = results.filter((l) => l.includes(': failed'));
  console.log(`${pkg}: ${results.length - failed.length} ok, ${failed.length} failed`);
  for (const line of failed) console.log(`  ${line}`);
  if (status !== 0 || failed.length > 0) {
    if (results.length === 0) console.log(output.slice(-4000));
    return false;
  }
  return true;
}

const dpm = resolveDpm();
verifyChecksums();
if (!process.argv.includes('--skip-build')) {
  const build = run(dpm, ['build', '--all'], root);
  if (build.status !== 0) {
    console.log(build.output.slice(-8000));
    console.error('dpm build --all failed');
    process.exit(1);
  }
  console.log('build ok     dpm build --all');
}
const ok = ['tests', 'scripts'].map((pkg) => runTests(dpm, pkg)).every(Boolean);
process.exit(ok ? 0 : 1);
