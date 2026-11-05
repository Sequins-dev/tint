import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { signCode } from "@tint/image/darwin/signature";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const blob = new Uint8Array([0xfa, 0xde, 0x71, 0x71, 0, 0, 0, 11, 1, 2, 3]);
const cases: string[] = [];
for (const length of [0, 3, 4096, 4097]) {
  for (const mode of ["omitted", "explicit", "extended"]) {
    const extended = mode === "extended";
    const code = Uint8Array.from({ length }, (_, i) => (i * 17 + 3) % 256);
    const result = signCode(code, {
      identifier: "tint.signer",
      executableOffset: 0,
      executableLength: length,
      mainExecutable: true,
      specialBlobs: extended ? [{ slot: 5, bytes: blob }] : undefined,
    });
    assert.ok(result.ok);
    const digest = createHash("sha256").update(result.value).digest();
    cases.push(`{
 const input=new Uint8Array(${length});for(let i=0;i<input.length;i++)input[i]=(i*17+3)%256;
 const result=signCode(input,{identifier:"tint.signer",executableOffset:0,executableLength:input.length,mainExecutable:true${mode === "omitted" ? "" : ",specialBlobs:" + (extended ? "[{slot:5,bytes:metadata}]" : "undefined")}});
 if(!result.ok||result.value.length!==${result.value.length})return 1;
 const digest=sha256(result.value);
 ${[...digest].map((value, index) => `if(digest[${index}]!==${value})return 2;`).join("\n")}
 }`);
  }
}
verifyHostedFixture(
  `import {signCode} from "signer";import {sha256} from "hash";
export function run():number {
 const metadata=new Uint8Array(${blob.length});
 ${[...blob].map((value, index) => `metadata[${index}]=${value};`).join("\n")}
 ${cases.join("\n")}
 const invalid=signCode(new Uint8Array(0),{identifier:"tint.signer",executableOffset:0,executableLength:0,mainExecutable:true,specialBlobs:[{slot:0,bytes:metadata}]});
 if(invalid.ok||invalid.error!=="INVALID_BLOB")return 3;
 return 42;
}`,
  "apple-signature",
  [
    ["signer", "packages/image/src/darwin/signature.ts"],
    ["hash", "packages/foundation/src/binary/sha256.ts"],
  ],
  [],
  [],
  [],
  { managedBytes: 16777216, allocationCapacity: 1048576 },
);
