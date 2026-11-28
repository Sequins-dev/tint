import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const source = `
import util, { callbackify, format, inspect, isDeepStrictEqual, MIMEType, parseArgs, parseEnv, promisify, TextDecoder as UtilDecoder, toUSVString } from "node:util";
import assert, { AssertionError, strict } from "node:assert";
import strictAssert, { equal } from "node:assert/strict";
import decoder, { StringDecoder } from "node:string_decoder";
import query, { parse, stringify, unescapeBuffer } from "node:querystring";
import { Buffer } from "node:buffer";
export async function run(): Promise<number> {
  if (util.TextDecoder !== TextDecoder || UtilDecoder !== TextDecoder || strict !== strictAssert || equal !== strictEqual()) return 1;
  if (decoder.StringDecoder !== StringDecoder || query.parse !== parse || query.decode !== parse) return 2;
  const cyclic: { value: number; self?: unknown } = {value: 1};
  cyclic.self = cyclic;
  const other = {value: 1, self: undefined};
  other.self = other;
  if (!isDeepStrictEqual(cyclic, other) || isDeepStrictEqual({value: -0}, {value: 0})) return 3;
  strictAssert.deepEqual(new Map([[{x:1},new Set([1,2])]]), new Map([[{x:1},new Set([2,1])]]));
  strictAssert.partialDeepStrictEqual([1,{a:2,b:3},4], [{a:2},4]);
  strictAssert.partialDeepStrictEqual(Uint8Array.of(1,2,3), Uint8Array.of(2));
  try { equal(1, "1"); return 4; } catch (error) {
    if (!(error instanceof AssertionError) || error.code !== "ERR_ASSERTION" || error.actual !== 1 || error.expected !== "1") return 5;
  }
  assert.equal(1,"1");
  strictAssert.throws(() => { throw new Error("boom"); }, /boom/u);
  strictAssert.throws(() => { throw new TypeError("boom"); }, {name:"TypeError",message:/boom/u});
  strictAssert.throws(() => assert.throws(() => { throw new Error("boom"); }, TypeError), {code:"ERR_ASSERTION"});
  await strictAssert.rejects(async () => { throw new Error("oops"); }, /oops/);
  if (format("%s:%d:%j:%%","a",2,{k:3}) !== 'a:2:{"k":3}:%' || inspect({a:[1,true]}) !== "{ a: [ 1, true ] }") return 6;
  const args = parseArgs({args:["-v","--name=x","tail"],options:{verbose:{type:"boolean",short:"v"},name:{type:"string"}},allowPositionals:true});
  if (args.values.name !== "x" || !args.values.verbose || args.positionals[0] !== "tail") return 7;
  const double = promisify((x: number, done: (error: unknown, value: number)=>void) => done(null,x * 2));
  if (await double(21) !== 42) return 8;
  const utf8 = new StringDecoder("utf-8");
  const bytes = new Uint8Array([0,0xe2,0x82,0xac,0]);
  if (utf8.write(new DataView(bytes.buffer,1,2)) !== "" || utf8.end(bytes.subarray(3,4)) !== "€") return 9;
  const utf16 = new StringDecoder("ucs-2");
  if (utf16.write(Uint8Array.of(0x3d,0xd8)) !== "" || utf16.end(Uint8Array.of(0x00,0xde)) !== "😀") return 10;
  const base64 = new StringDecoder("base64");
  if (base64.write(Uint8Array.of(1,2)) !== "" || base64.end(Uint8Array.of(3,4)) !== "AQIDBA==") return 11;
  const value = parse("a=1&a=2&__proto__=x&utf=%E2%82%AC+!");
  if (Object.getPrototypeOf(value)!==null || value.a.join() !== "1,2" || value.__proto__!=="x" || value.utf!=="€ !") return 12;
  if (stringify({a:[1,true],b:"?+"})!=="a=1&a=true&b=%3F%2B" || !Buffer.isBuffer(unescapeBuffer("%FF"))) return 13;
  const dynamic = await import("node:assert/strict");
  if (dynamic.default !== strictAssert || dynamic.equal !== equal) return 14;
  if ((await import("node:util")).default !== util || (await import("node:assert")).default !== assert) return 15;
  if ((await import("node:string_decoder")).StringDecoder !== StringDecoder || (await import("node:querystring")).parse !== parse) return 16;
  if (parse("x=€%ZZ+!").x !== "€%ZZ !" || parse("a=1&b=2","&","=",{maxKeys:1}).b !== undefined) return 17;
  const custom = parse("a=&b=two+words","&","=",{decodeURIComponent: value => "[" + value + "]"});
  if (custom["[a]"] !== "" || custom["[b]"] !== "[two%20words]") return 18;
  const mime = new MIMEType("TEXT/Plain;charset=UTF-8");
  mime.params.set("purpose", "two words");
  if (mime.essence !== "text/plain" || mime.params.get("charset") !== "UTF-8" || mime.toString() !== 'text/plain;charset=UTF-8;purpose="two words"') return 19;
  if (parseEnv("export VALUE='two words' # comment").VALUE !== "two words" || toUSVString("\\uD800x") !== "�x") return 20;
  const reason = await new Promise(resolve => {
    const wrapped = callbackify(async () => { throw 0; });
    wrapped(resolve);
  });
  if (reason.code !== "ERR_FALSY_VALUE_REJECTION" || reason.reason !== 0) return 21;
  const separated = parse("x&one&&y&two","&&","&");
  if (separated["x&one"] !== "" || separated["y&two"] !== "") return 22;
  return 42;
}
function strictEqual(): unknown { return strictAssert.strictEqual; }
`;

test("util, assert and codecs match Node", async () => {
  const fixture = (await import(
    "data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source))
  )) as {
    run(): Promise<number>;
  };
  assert.equal(await fixture.run(), 42);
});

test("util, assert and codecs share native ESM identities", () => {
  const compiled: { general?: readonly string[] } = {};
  verifyHostedFixture(
    source,
    "m1p5-util-assert-codecs",
    [
      ["node:util", "packages/native-runtime/src/node/util.ts"],
      ["node:assert", "packages/native-runtime/src/node/assert.ts"],
      [
        "node:assert/strict",
        "packages/native-runtime/src/node/assert-strict.ts",
      ],
      [
        "node:string_decoder",
        "packages/native-runtime/src/node/string-decoder.ts",
      ],
      ["node:querystring", "packages/native-runtime/src/node/querystring.ts"],
      ["node:buffer", "packages/native-runtime/src/node/buffer.ts"],
    ],
    [],
    [],
    [],
    {
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      onGeneralFallback(modules) {
        compiled.general = modules;
      },
    },
  );
  assert.ok(
    compiled.general?.includes("packages/native-runtime/src/node/util.ts"),
  );
  assert.equal(
    compiled.general?.includes("packages/native-runtime/src/node/buffer.ts"),
    false,
  );
});
