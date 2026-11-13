// Leaf (self) samples of a pprofessor/pprof profile, by linked address of
// one binary: parses `go tool pprof -raw`. Shared by op-cost/analyze.ts and
// disasm/annotate.ts.
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

export interface LeafSamples {
  /** Every sample in the profile, attributed or not. */
  readonly total: number;
  /** Self samples by linked (unslid) address within the binary's image. */
  readonly byAddress: ReadonlyMap<number, number>;
}

/** Parses `go tool pprof -raw` text. Linked Mach-O addresses start at
 * 0x100000000; the binary's mapping gives the runtime slide. */
export function parseRawProfile(raw: string, binary: string): LeafSamples {
  const [samplePart = "", rest = ""] = raw.split("Locations");
  const [locationPart = "", mappingPart = ""] = rest.split("Mappings");
  const name = basename(binary);
  let slide = 0;
  for (const match of mappingPart.matchAll(
    /^\d+: (0x[0-9a-f]+)\/(0x[0-9a-f]+)\/0x[0-9a-f]+ (\S+)/gm,
  ))
    if ((match[3] ?? "").endsWith(name)) {
      slide = parseInt(match[1] ?? "0", 16) - 0x100000000;
      break;
    }
  const locations = new Map<number, number>();
  for (const match of locationPart.matchAll(/^\s*(\d+): (0x[0-9a-f]+)/gm))
    locations.set(Number(match[1]), parseInt(match[2] ?? "0", 16));
  const byAddress = new Map<number, number>();
  let total = 0;
  for (const match of samplePart.matchAll(/^\s+(\d+)\s+\d+: ([\d ]+)$/gm)) {
    const count = Number(match[1]),
      leaf = Number((match[2] ?? "").trim().split(/\s+/)[0]);
    total += count;
    const address = locations.get(leaf);
    if (address === undefined) continue;
    byAddress.set(
      address - slide,
      (byAddress.get(address - slide) ?? 0) + count,
    );
  }
  return { total, byAddress };
}

export function leafSamples(profile: string, binary: string): LeafSamples {
  const run = spawnSync("go", ["tool", "pprof", "-raw", profile], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (run.status !== 0)
    throw Error("go tool pprof -raw failed: " + (run.stderr ?? ""));
  return parseRawProfile(run.stdout, binary);
}
