import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {decodeHexInto,encodeHex} from "codec";
export function run():number {
 const bytes=new Uint8Array(256);for(let i=0;i<256;i++)bytes[i]=i;
 const encoded=encodeHex(bytes,0,256);if(encoded===undefined||encoded.length!==512||encoded.slice(0,8)!=="00010203"||encoded.slice(508)!=="feff")return 1;
 const target=new Uint8Array(258);target[0]=91;target[257]=92;
 const result=decodeHexInto(encoded,target,1,256);if(result.error!=="none"||result.read!==512||result.written!==256)return 2;
 for(let i=0;i<256;i++)if(target[i+1]!==i)return 3;
 if(target[0]!==91||target[257]!==92)return 4;
 const partial=decodeHexInto("AAag",target,1,2);if(partial.error!=="syntax"||partial.read!==2||partial.written!==1||target[1]!==170||target[2]!==1)return 5;
 const odd=decodeHexInto("fff",target,0,0);if(odd.error!=="syntax"||target[0]!==91)return 6;
 const clipped=decodeHexInto("bbzz",target,1,1);if(clipped.error!=="none"||clipped.read!==2||target[1]!==187)return 7;
 return 42;
}`,
  "hex-codec",
  [["codec", "packages/foundation/src/text/base-encoding/index.ts"]],
);
