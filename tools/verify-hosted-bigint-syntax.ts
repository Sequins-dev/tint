import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceText} from "source";
import {parseScript,scan,literalPropertyName} from "syntax";
import {bindScript} from "binding";
import {lowerScript} from "lowering";
export function run():number {
 const bytes=new TextEncoder().encode("0xffff_ffff_ffff_ffffn;");
 const source=createSourceText(bytes,bytes.length);if(!source.ok)return 1;
 const tokens=scan(source.value);if(!tokens.ok)return 2;
 const first=tokens.value[0];if(first===undefined||first.kind!=="bigint"||first.value!=="0xffff_ffff_ffff_ffffn")return 3;
 const parsed=parseScript(source.value);if(!parsed.ok)return 4;
 const stmt=parsed.value.statements[0];if(stmt===undefined||stmt.kind!=="expression")return 5;
 const value=stmt.expression;if(value.kind!=="bigint"||value.value!=="18446744073709551615")return 6;
 if(literalPropertyName(value)!=="18446744073709551615")return 7;
 if(!bindScript(parsed.value).ok)return 8;
 const lowered=lowerScript(parsed.value);if(!lowered.ok)return 9;
 const invalidBytes=new TextEncoder().encode("1.0n");
 const invalid=createSourceText(invalidBytes,invalidBytes.length);if(!invalid.ok)return 10;
 const rejected=scan(invalid.value);if(rejected.ok||rejected.error.code!=="LEXICAL_ERROR")return 11;
 return 42;
}`,
  "bigint-syntax",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["lowering", "packages/js-engine/src/lowering/index.ts"],
  ],
);
