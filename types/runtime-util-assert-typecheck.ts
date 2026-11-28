import assert from "node:assert";
import strict, { AssertionError } from "node:assert/strict";
import { StringDecoder } from "node:string_decoder";
import query from "node:querystring";
import util, {
  parseArgs,
  promisify,
  TextEncoder as NodeEncoder,
} from "node:util";

declare const value: string | undefined;
assert(value);
value.toUpperCase();
strict.equal(value, "yes");
const code: "ERR_ASSERTION" = new AssertionError({ actual: "a", expected: "b" })
  .code;
const args = parseArgs({
  options: {
    count: { type: "string", multiple: true },
    quiet: { type: "boolean" },
  },
  tokens: true,
});
const count: string[] | undefined = args.values.count;
const quiet: boolean | undefined = args.values.quiet;
const asyncCount = promisify(
  (name: string, cb: (error: Error | null, count: number) => void) =>
    cb(null, name.length),
);
const pending: Promise<number> = asyncCount("items");
const encoder: TextEncoder = new NodeEncoder();
const decoded: string = new StringDecoder("base64").write(
  encoder.encode("abc"),
);
const raw: Uint8Array = query.unescapeBuffer("%ff");
const formatted: string = util.inspect(raw);
void [code, count, quiet, pending, decoded, formatted, args.tokens];
// @ts-expect-error Decoders accept byte views or strings.
new StringDecoder().write(123);
// @ts-expect-error Option kinds are literal types.
parseArgs({ options: { count: { type: "number" } } });
// @ts-expect-error The callback wrapper preserves its parameter type.
asyncCount(123);
// @ts-expect-error Match requires a RegExp.
strict.match("hello", "he");
