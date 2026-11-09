// Static instruction-class profile of a native image: prologue root clears
// (zero stores before the first branch/call of each function) and frame traffic.
import { execFileSync } from "node:child_process";
const image = process.argv[2]!;
const text = execFileSync("/opt/homebrew/opt/llvm/bin/llvm-objdump", ["-d", "--no-show-raw-insn", "--no-leading-addr", image], { maxBuffer: 1 << 30 }).toString();
let fmov = 0, fns = 0, total = 0, prologueZeroWords = 0, prologueZeroInsns = 0, spLoads = 0, spStores = 0, zeroStores = 0, inPrologue = false, fnZero = 0;
const perFn: number[] = [];
for (const raw of text.split("\n")) {
  if (/^<.*>:$/.test(raw.trim()) || /^[0-9a-f]+ <.*>:$/.test(raw.trim())) { if (fns > 0) perFn.push(fnZero); fns++; inPrologue = true; fnZero = 0; continue; }
  const line = raw.trim(); if (!line || line.endsWith(":")) continue;
  const [op, ...rest] = line.split(/\s+/); const args = rest.join(" ");
  if (!op || op.startsWith(".")) continue;
  total++;
  if (op === "fmov") fmov++;
  const zero = (op === "str" && /^xzr, \[sp/.test(args)) ? 1 : (op === "stp" && /^xzr, xzr, \[sp/.test(args)) ? 2 : 0;
  if (zero) zeroStores += zero;
  if (/^(ldr|ldp|ldur)$/.test(op) && /\[sp/.test(args)) spLoads++;
  if (/^(str|stp|stur)$/.test(op) && /\[sp/.test(args) && !zero) spStores++;
  if (inPrologue) {
    if (/^(b|bl|blr|br|ret|cbz|cbnz|tbz|tbnz)$/.test(op) || op.startsWith("b.")) inPrologue = false;
    else if (zero) { prologueZeroWords += zero; prologueZeroInsns++; fnZero += zero; }
  }
}
perFn.push(fnZero);
perFn.sort((a, b) => b - a);
console.log(JSON.stringify({ image, fmov, fns, total, spLoads, spStores, zeroStoreWords: zeroStores, prologueZeroWords, prologueZeroInsns, top: perFn.slice(0, 8), fnsWithPrologueZero: perFn.filter((x) => x > 0).length }));
