// CLI for the LocalNet seed (wrapped by scripts/localnet/seed.mjs and the root script `pnpm localnet:seed`).
//   --profile clean-start|main    (default main)
//   --prefix <p>                  isolated namespace: state-<p>.json and, without --database-url, the
//                                 database collara_<p> (dashes become underscores)
//   --database-url <postgres://…> default: DATABASE_URL (with --prefix: its database renamed to collara_<p>)
//   --state <path>                bootstrap state file (overrides --prefix for the state)
//   --skip-documents              ledger only: label hashes instead of uploaded files
//   --force-new-namespace         namespace taken by another seed: use <namespace>-rN instead (never wipes)
//   --json                        print the report as JSON
import { parseArgs } from "node:util";
import { seedLocalnet, SeedRefusedError, type SeedProfile } from "./localnet";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    profile: { type: "string", default: "main" },
    prefix: { type: "string" },
    "database-url": { type: "string" },
    state: { type: "string" },
    "skip-documents": { type: "boolean", default: false },
    "force-new-namespace": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const profile = values.profile as SeedProfile;
if (profile !== "main" && profile !== "clean-start") {
  console.error("--profile must be main or clean-start");
  process.exit(2);
}
if (values.prefix !== undefined && !/^[a-z0-9][a-z0-9-]{0,30}$/.test(values.prefix)) {
  console.error("--prefix: 1-31 lower-case letters, digits or '-'");
  process.exit(2);
}

function databaseUrl(): string {
  if (values["database-url"]) return values["database-url"];
  const base = process.env.DATABASE_URL;
  if (!base) throw new SeedRefusedError("DATABASE_URL is not set (or pass --database-url)");
  if (!values.prefix) return base;
  const url = new URL(base);
  url.pathname = `/collara_${values.prefix.replaceAll("-", "_")}`;
  return url.toString();
}

try {
  const report = await seedLocalnet({
    profile,
    prefix: values.prefix ?? null,
    ...(values.state ? { statePath: values.state } : {}),
    databaseUrl: databaseUrl(),
    skipDocuments: values["skip-documents"],
    forceNewNamespace: values["force-new-namespace"],
    log: values.json ? () => undefined : (line) => console.log(line),
  });
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const replayed = report.steps.filter((s) => s.replayed).length;
    console.log(`\nseeded ${report.profile} on ${report.namespace} in ${report.totalMs} ms: ${report.steps.length} ledger steps (${replayed} replayed), ${report.documents.length} document versions`);
    for (const [view, counts] of Object.entries(report.contracts)) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      console.log(`  ${view.padEnd(9)} ${String(total).padStart(3)} active: ${Object.entries(counts).map(([t, n]) => `${t.split(":").pop()}×${n}`).join(", ")}`);
    }
  }
} catch (error) {
  console.error(`seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
