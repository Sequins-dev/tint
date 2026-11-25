// General-path string benchmark kernels (tools/string-bench/bench.ts
// --suite general). These operations do not lower in typed code yet
// (`toUpperCase` is an invalid typed method call; `JSON` is not a typed
// value), so this file compiles with the general fallback allowed and
// measures Tint's general (JavaScript) runtime. Same conventions as
// kernels.ts: a scale in, a deterministic 32-bit checksum out.

const words: readonly string[] = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
];

function sentence(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++)
    text +=
      "line " + String(i) + ": the quick brown fox jumps over the lazy dog\n";
  return text;
}

function mix(checksum: number, value: number): number {
  return (Math.imul(checksum, 31) + value) | 0;
}

// --- Case conversion. ---
export function upperCase(scale: number): number {
  const text = sentence(8);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const upper = text.toUpperCase();
    checksum = mix(checksum, upper.charCodeAt(round % upper.length));
  }
  return checksum;
}

// --- JSON: stringify and parse a small record array with string fields. ---
interface Entry {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
}
export function json(scale: number): number {
  const entries: Entry[] = [];
  for (let i = 0; i < 32; i++)
    entries.push({
      name: "symbol_" + String(i),
      kind: words[i & 7] ?? "",
      line: i * 17,
    });
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const text = JSON.stringify(entries);
    const back = JSON.parse(text) as Entry[];
    checksum = mix(checksum, text.length + back.length);
    checksum = mix(checksum, (back[round & 31]?.name ?? "").length);
  }
  return checksum;
}
