import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test262Checkout, test262Source } from "./test262-checkout.ts";
import { testMetadata, syntaxVariants } from "./test262.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const [checkout, output, selection = "."] = process.argv.slice(2);
if (!checkout || !output)
  throw Error(
    "usage: node tools/build-test262-native-parser.ts <checkout> <new-run-directory> [selection]",
  );
const suite = test262Checkout(checkout, selection),
  directory = resolve(output);
mkdirSync(directory); // Never overwrite a previous run's inputs.
const cases = suite.files.flatMap(({ filename, path }) => {
  const { source, sha256 } = test262Source(filename),
    metadata = testMetadata(source);
  if (/[\t\r\n]/.test(path)) throw Error("manifest path contains a separator");
  return syntaxVariants(metadata).map((variant) => ({
    path,
    sha256,
    variant,
    negative:
      metadata.negative?.phase === "parse" ||
      metadata.negative?.phase === "early",
  }));
});
const manifest = resolve(directory, "cases.tsv");
writeFileSync(
  manifest,
  cases.map((item) => item.variant + "\t" + item.path).join("\n"),
);
writeFileSync(
  resolve(directory, "manifest.json"),
  JSON.stringify(
    {
      revision: suite.revision,
      dirty: suite.dirty,
      selection,
      root: suite.root,
      cases,
    },
    null,
    2,
  ) + "\n",
);
// Build one native parser. Test sources are read as data and never evaluated.
process.env.TINT_BUILD_ONLY = "1";
verifyHostedFixture(
  `
import {createNativeFileHost} from "fs";
import {readFile} from "files";
import {writeAll} from "io";
import {createSourceText} from "source";
import {parseScript,parseModule} from "syntax";
import {validateJavaScriptBindings} from "binding";
const host=createNativeFileHost();
function report(text:string):void {
 const bytes=new TextEncoder().encode(text+"\\n");
 const result=writeAll((buffer)=>host.write(1,buffer),bytes);
 if(!result.ok)throw "REPORT_WRITE_FAILED";
}
function inspect(path:string,variant:string):string {
 const loaded=readFile<number>(host,${JSON.stringify(resolve(suite.root, "test"))}+"/"+path,67108864);
 if(!loaded.ok)return "READ_ERROR";
 let bytes=loaded.value;
 if(variant==="strict") {
  const prefix=new TextEncoder().encode('"use strict";\\n');
  const combined=new Uint8Array(prefix.length+bytes.length);
  for(let i=0;i<prefix.length;i++)combined[i]=prefix[i]??0;
  for(let i=0;i<bytes.length;i++)combined[prefix.length+i]=bytes[i]??0;
  bytes=combined;
 }
 const source=createSourceText(bytes,bytes.length);
 if(!source.ok)return "SOURCE_ERROR";
 const goal:"script"|"module"=variant==="module"?"module":"script";
 const parsed=goal==="module"?parseModule(source.value,"javascript"):parseScript(source.value);
 if(!parsed.ok)return parsed.error.code;
 const error=validateJavaScriptBindings(parsed.value,goal);
 return error===undefined?"ACCEPTED":error.code;
}
export function run():number {
 const loaded=readFile<number>(host,${JSON.stringify(manifest)},67108864);
 if(!loaded.ok)return 1;
 const text=new TextDecoder().decode(loaded.value);
 const lines=text.split("\\n");
 for(let index=0;index<lines.length;index++) {
  const line=lines[index];if(line===undefined)return 2;
  const fields=line.split("\\t"),variant=fields[0],path=fields[1];
  if(variant===undefined||path===undefined)return 3;
  report("CASE\\t"+index+"\\t"+inspect(path,variant));
 }
 report("COMPLETE\\t"+lines.length);
 return 42;
}
`,
  "test262-parser",
  [
    ["fs", "packages/platform/src/darwin/fs.ts"],
    ["files", "packages/platform/src/files/service.ts"],
    ["io", "packages/platform/src/io/sync.ts"],
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
  ],
  [],
  [],
  [],
  {
    // Match compiler-cli's compiler-host resources. Large generated syntax
    // tables need its heap budget as well as its recursive parser stack.
    managedBytes: 3221225472,
    allocationCapacity: 100663296,
    rootCapacity: 1048576,
    stackBytes: 268435456,
  },
);
