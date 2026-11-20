import { verifyHostedFixture } from "./hosted-fixture.ts";
import { createHostedSourceValidator } from "./source-validation.ts";

// The rejected inputs deliberately cross explicit contracts after type erasure.
const asyncSource = `let order = "";
function kernel(value: number): number { return value * 2; }
async function produce(): Promise<number> {
  const awaited = await kernel(3.5);
  if (awaited !== 7) throw 2;
  order += "awaited,";
  const thenable = { then(resolve: (value: unknown) => void): void {
    order += "then,";
    resolve("bad");
  } };
  return thenable as any;
}
export function run(): number {
  let pending: Promise<number>;
  try { pending = produce(); }
  catch { return 3; }
  if (order !== "") return 4;
  pending.then(
    () => { throw 5; },
    (error: unknown) => { if (!(error instanceof TypeError) || order !== "awaited,then,") throw 6; },
  );
  return 42;
}`;

const generatorSource = `let finalized = 0;
function kernel(value: number): number { return value * 2; }
function* observe(): Generator<number, number, string> {
  try {
    yield "wrong" as any;
    throw 2;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  try { const value = yield 11; return value.length; }
  catch (error) { if (error instanceof TypeError) return kernel(21); throw error; }
  finally { finalized++; }
}
function* badReturn(): Generator<number, number, unknown> {
  try { yield 1; return "wrong" as any; }
  finally { finalized++; }
}
export function run(): number {
  const values = observe();
  const first = values.next(false as any);
  if (first.done || first.value !== 11 || finalized !== 0) return 3;
  const last = values.next(false as any);
  if (!last.done || last.value !== 42 || Number(finalized) !== 1) return 4;
  const bad = badReturn();
  if (bad.next().value !== 1) return 5;
  try { bad.next(); }
  catch (error) { return error instanceof TypeError && Number(finalized) === 2 ? 42 : 6; }
  return 7;
}`;

const asyncGeneratorSource = `let finalized = 0;
function kernel(value: number): number { return value * 2; }
async function* observe(): AsyncGenerator<number, number, string> {
  try { yield "bad" as any; throw 2; }
  catch (error) { if (!(error instanceof TypeError)) throw error; }
  try { const value = yield kernel(5); return value.length; }
  catch (error) { if (error instanceof TypeError) return "bad" as any; throw error; }
  finally { finalized++; }
}
export function run(): number {
  const sequence = observe();
  sequence.next(false as any).then((first) => {
    if (first.done || first.value !== 10) throw 3;
    return sequence.next(false as any).then(
      () => { throw 4; },
      (error: unknown) => { if (!(error instanceof TypeError) || finalized !== 1) throw 5; },
    );
  });
  return 42;
}`;

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("suspension fixtures require TINT_BUILD_ONLY=1");
const variant = process.argv[2];
const source =
  variant === "async"
    ? asyncSource
    : variant === "generator"
      ? generatorSource
      : variant === "async-generator"
        ? asyncGeneratorSource
        : undefined;
if (source === undefined)
  throw Error("expected async, generator or async-generator");
verifyHostedFixture(source, "slice3-suspension-" + variant, [], [], [], [], {
  managedBytes: 67108864,
  allocationCapacity: 1048576,
  functionFallback: true,
  validateSource: createHostedSourceValidator([
    { id: "fixture", text: source },
  ]),
});
