import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {createListFormatter,formatList,formatListParts,lookupListFormatLocale} from "format";
export function run():number{
 const en=createListFormatter("en","conjunction","long");
 const gb=createListFormatter("en-GB","conjunction","long");
 const es=createListFormatter("es","conjunction","long");
 const or=createListFormatter("es","disjunction","long");
 const he=createListFormatter("he","conjunction","long");
 if(en===undefined||gb===undefined||es===undefined||or===undefined||he===undefined)return 1;
 if(formatList(en,["A","B","C"])!=="A, B, and C"||formatList(gb,["A","B","C"])!=="A, B and C")return 2;
 if(formatList(es,["A","híbrido"])!=="A e híbrido"||formatList(or,["A","11.000"])!=="A u 11.000")return 3;
 if(formatList(he,["A","B"])!=="A ו-B"||formatList(he,["A","ב"])!=="A וב")return 4;
 const parts=formatListParts(en,[""]);if(parts.length!==1||parts[0]?.type!=="element"||parts[0]?.value!=="")return 5;
 if(lookupListFormatLocale("en-US-u-ca-gregory")!=="en-US"||lookupListFormatLocale("zxx")!==undefined)return 6;
 return 42;
}`,
  "list-format",
  [["format", "packages/js-runtime/src/objects/list-format.ts"]],
);
