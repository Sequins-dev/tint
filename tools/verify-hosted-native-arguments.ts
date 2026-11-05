import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {argumentCount,argumentByteLength,copyArgument} from "process";
function matches(index:number,expected:string):boolean {
  const length=argumentByteLength(index);
  if(length!==expected.length)return false;
  const bytes=new Uint8Array(length);
  if(copyArgument(index,bytes)!==length)return false;
  for(let i=0;i<length;i++)if(bytes[i]!==expected.charCodeAt(i))return false;
  return true;
}
export function run():number {
  if(argumentCount()!==3)return 1;
  if(!matches(1,"--debug-symbols"))return 2;
  if(!matches(2,"-c"))return 3;
  return 42;
}`,
  "native-arguments",
  [["process", "packages/native-runtime/src/intrinsics/process.ts"]],
);
