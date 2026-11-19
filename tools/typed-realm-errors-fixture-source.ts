// This source runs unchanged under Node and in a typed-only native image.
export const typedRealmErrorsSource = `function describe(error: Error | string): string {
  if (!(error instanceof Error)) return error;
  return error.name + ": " + error.message;
}
function raise(value: unknown): never { throw value; }
function optionalMessage(message: string | undefined): string { return new Error(message).message; }
export function run(): number {
  const plain: Error = new Error("plain");
  const type: Error = new TypeError();
  const range: Error = new RangeError("range");
  if (!(plain instanceof Error) || plain instanceof TypeError || plain instanceof RangeError) return 1;
  if (!(type instanceof Error) || !(type instanceof TypeError) || type instanceof RangeError) return 2;
  if (!(range instanceof Error) || !(range instanceof RangeError) || range instanceof TypeError) return 3;
  if (describe(plain) !== "Error: plain" || describe(type) !== "TypeError: " ||
      describe(range) !== "RangeError: range" || describe("value") !== "value") return 4;
  if (new Error().message !== "" || new Error(undefined).message !== "" ||
      optionalMessage(undefined) !== "" || optionalMessage("given") !== "given") return 5;
  let path = "";
  try {
    try { raise(range); }
    catch (e) { if (e instanceof RangeError) path = e.message; throw e; }
    finally { path += "!"; }
  } catch (e) {
    if (!(e instanceof Error)) return 6;
    if (e !== range || e.name !== "RangeError" || path !== "range!") return 7;
  }
  try { raise(41); }
  catch (e) { if (e instanceof Error || e !== 41) return 8; }
  return 42;
}
`;
