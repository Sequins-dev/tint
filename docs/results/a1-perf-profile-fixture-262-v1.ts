// usage: TINT_DEBUG_SYMBOLS=1 TINT_BUILD_ONLY=1 node build-profile-fixture.ts <out-cases.json> <test path>...
// Builds one native Script fixture image whose case i is harness (assert.js, sta.js, includes) + test i.
import { readFileSync, writeFileSync } from "node:fs";
import { verifyNativeScriptCases } from "../../tools/native-script-fixture.ts";
const root = "/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262/";
const [out, ...paths] = process.argv.slice(2);
const sources = paths.map((path) => {
  const source = readFileSync(root + "test/" + path, "utf8");
  const includes = /includes:\s*\[([^\]]*)\]/.exec(source)?.[1].split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const strict = /flags:\s*\[[^\]]*onlyStrict/.test(source) ? '"use strict";\n' : "";
  return strict + "var $262 = { detachArrayBuffer: function (buffer) { buffer.transfer(); } };\n" + ["assert.js", "sta.js", ...includes].map((name) => readFileSync(root + "harness/" + name, "utf8")).join("\n") + "\n" + source;
});
writeFileSync(out, JSON.stringify(paths.map((path, index) => ({ index, path })), null, 1));
verifyNativeScriptCases(sources, { nodeReference: true });
