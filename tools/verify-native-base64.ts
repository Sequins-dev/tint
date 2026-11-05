import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {decodeBase64Into,encodeBase64} from "codec";
export function run():number {
 const target=new Uint8Array(10);target[0]=91;target[9]=92;
 const first=decodeBase64Into("Zm9vYmFy",target,1,5,"base64","loose");if(first.error!=="none"||first.read!==4||first.written!==3||target[1]!==102||target[2]!==111||target[3]!==111)return 1;
 const failed=decodeBase64Into("ZXhhZh==",target,1,6,"base64","strict");if(failed.error!=="syntax"||failed.read!==4||failed.written!==3||target[3]!==97)return 2;
 const padded=decodeBase64Into("ZXhhZg==",target,1,6,"base64","strict");if(padded.error!=="none"||padded.read!==8||padded.written!==4||target[4]!==102)return 3;
 if(encodeBase64(target,1,4,"base64",false)!=="ZXhhZg=="||encodeBase64(target,1,4,"base64",true)!=="ZXhhZg")return 4;
 const partial=decodeBase64Into("Zg",target,1,3,"base64","stop-before-partial");if(partial.error!=="none"||partial.read!==0||partial.written!==0)return 5;
 const url=decodeBase64Into("x-_y",target,1,3,"base64url","strict");if(url.error!=="none"||target[1]!==199||target[2]!==239||target[3]!==242||encodeBase64(target,1,3,"base64url",false)!=="x-_y")return 6;
 if(target[0]!==91||target[9]!==92)return 7;
 return 42;
}`,
  "base64-codec",
  [["codec", "packages/foundation/src/text/base-encoding/index.ts"]],
);
