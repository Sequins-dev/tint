// Node reference for the Worker-performance images
// (docs/results/worker-runtime-baseline-v1.md). Run with Node 26.13.1:
//   node tools/worker-bench/node-run.ts <plain|copying|raw|main|worker|transport|typed-transport> [expected]
// `expected` is the JSON checksum list the native build embedded. Exits 42.
import { fileURLToPath } from "node:url";
import { kernelNames, kernelScale, runKernel } from "./kernels.ts";
import { runKernelList, runKernelsInline } from "./inline.ts";
import { rawKernelNames, rawKernelScale, runRawKernel } from "./raw-kernels.ts";
import { runKernelsBesideWorker, runKernelsInWorker } from "./placements.ts";

const variant = process.argv[2] ?? "";
const now = (): number => performance.now();
function finish(status: number): void {
  process.exitCode = status;
}
const peer = fileURLToPath(new URL("./peer.ts", import.meta.url));
const supplied = process.argv[3];
const expected: readonly number[] =
  variant === "transport" || variant === "typed-transport"
    ? []
    : supplied !== undefined
      ? (JSON.parse(supplied) as number[])
      : variant === "raw"
        ? rawKernelNames().map((name) =>
            runRawKernel(name, rawKernelScale(name)),
          )
        : kernelNames.map((name) => runKernel(name, kernelScale(name)));
if (variant === "plain" || variant === "copying")
  finish(runKernelsInline(variant, now, expected));
else if (variant === "raw")
  finish(
    runKernelList(
      "raw",
      now,
      expected,
      rawKernelNames(),
      rawKernelScale,
      runRawKernel,
    ),
  );
else if (variant === "main")
  runKernelsBesideWorker(peer, now, expected, finish);
else if (variant === "worker") runKernelsInWorker(peer, now, expected, finish);
else if (variant === "typed-transport") {
  const { runTypedTransport } = await import("./typed-transport.ts");
  runTypedTransport(
    fileURLToPath(new URL("./typed-transport-peer.ts", import.meta.url)),
    now,
    finish,
  );
} else if (variant === "transport") {
  const transport = new URL("./transport.mjs", import.meta.url);
  const { run } = (await import(transport.href)) as {
    run: (filename: string, now: () => number) => Promise<number>;
  };
  finish(await run(fileURLToPath(transport), now));
} else throw Error("unknown Worker benchmark variant " + variant);
