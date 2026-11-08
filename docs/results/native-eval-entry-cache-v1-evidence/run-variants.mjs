// Usage: node run-variants.mjs <toolchain-dir> <variants.json> <selection-root> <batch> <prefix>
// Runs an explicit-variant canonical native report under the runner slot.
import { readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const [toolchain, variants, root, batch, prefixArg] = process.argv.slice(2);
const dir = resolve(toolchain), prefix = resolve(prefixArg);
const suite = "/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262";
const env = { ...process.env, TINT_TEST262_SOURCES: dir + "/source-snapshot.json", TINT_TEST262_VARIANTS: resolve(variants), TINT_TEST262_JOURNAL: prefix + ".jsonl", TINT_TEST262_CONTAINMENT_MS: "300000", TINT_TEST262_HEARTBEAT_MS: "30000", TINT_TEST262_STALL_MS: "150000", TINT_TEST262_DEBUGGER_LAUNCH: "debugserver-direct" };
delete env.TINT_TEST262_MODULES;
const args = ["runner", "8", "--", process.execPath, dir + "/tools/test262-native-run.ts", suite, root, batch];
writeFileSync(prefix + "-inputs.json", JSON.stringify({ toolchain: dir, toolchainManifest: JSON.parse(readFileSync(dir + "/toolchain.json", "utf8")).sourceSnapshot, args, env: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("TINT_TEST262_"))), node: process.version, startedUTC: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
const out = openSync(prefix + ".json", "wx"), log = openSync(prefix + ".log", "wx");
const started = new Date().toISOString();
const r = spawnSync("/Users/stephenbelanger/.t3/tint-slots/slot", args, { env, stdio: ["ignore", out, log] });
closeSync(out); closeSync(log);
writeFileSync(prefix + "-exit.json", JSON.stringify({ startedUTC: started, endedUTC: new Date().toISOString(), status: r.status, signal: r.signal }, null, 2) + "\n");
