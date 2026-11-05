import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("foundation text fixture requires TINT_BUILD_ONLY=1");
verifyHostedFixture(
  `import {createScanner} from 'scanner';
import {createStringBuilder,appendString,finishString} from 'builder';
import {parseJSONText} from 'json';
import {encodeUTF8,decodeUTF8,createUTF8Decoder,encodeURIString,decodeURIString,toWellFormedUTF16} from 'encoding';
import {encodeHex,decodeHexInto,encodeBase64,decodeBase64Into} from 'base';
export function run():number {
 const cursor=createScanner('abc:42');if(!cursor.match('abc:')||cursor.offset()!==4)return 1;
 const mark=cursor.mark();if(cursor.eatWhile((code):boolean=>code>=48&&code<=57)!=='42'||!cursor.done()||!cursor.restore(mark)||cursor.peekCode()!==52)return 2;
 const output=createStringBuilder();appendString(output,'a');appendString(output,'bc');if(finishString(output)!=='abc')return 3;
 const parsed=parseJSONText('{"a":1,"a":[true,null]}');const node=parsed.node;if(node===undefined||node.kind!=='object'||node.entries.length!==2)return 4;
 if(parseJSONText('[1,]').node!==undefined)return 5;
 const bytes=encodeUTF8('A😀');if(bytes.length!==5||bytes[0]!==65||bytes[4]!==128)return 6;
 if(decodeUTF8(createUTF8Decoder(),bytes,false)!=='A😀')return 7;
 if(toWellFormedUTF16(String.fromCharCode(55296))!=='�')return 8;
 const escaped=encodeURIString('a/b 😀',true);if(escaped.error!=='none'||escaped.value!=='a%2Fb%20%F0%9F%98%80')return 9;
 const decoded=decodeURIString(escaped.value,true);if(decoded.error!=='none'||decoded.value!=='a/b 😀')return 10;
 if(encodeHex(bytes,0,5)!=='41f09f9880'||encodeBase64(bytes,0,5,'base64',false)!=='QfCfmIA=')return 11;
 const target=new Uint8Array(7);target[0]=91;target[6]=92;
 const hex=decodeHexInto('41f09f9880',target,1,5);if(hex.error!=='none'||hex.written!==5||target[5]!==128||target[0]!==91||target[6]!==92)return 12;
 const base=decodeBase64Into('QfCfmIA=',target,1,5,'base64','strict');if(base.error!=='none'||base.written!==5||target[5]!==128)return 13;
 return 42;
}`,
  "foundation-text-v1",
  [
    ["scanner", "packages/foundation/src/text/text-scanner.ts"],
    ["builder", "packages/foundation/src/text/string-builder.ts"],
    ["json", "packages/foundation/src/text/json-syntax.ts"],
    ["encoding", "packages/foundation/src/text/text-encoding/index.ts"],
    ["base", "packages/foundation/src/text/base-encoding/index.ts"],
  ],
);
