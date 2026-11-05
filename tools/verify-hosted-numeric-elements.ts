import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {readNumericElement,writeNumericElement,clampUint8} from "elements";
export function run():number{
 const bytes=new Uint8Array(16);
 writeNumericElement(bytes,1,"Int32",4294967295,"little");
 if(readNumericElement(bytes,1,"Int32","little")!==-1||readNumericElement(bytes,1,"Uint32","little")!==4294967295)return 1;
 writeNumericElement(bytes,2,"Uint16",65537,"big");if(bytes[2]!==0||bytes[3]!==1)return 2;
 writeNumericElement(bytes,0,"Uint8Clamped",2.5,"little");if(bytes[0]!==2||clampUint8(1.5)!==2||clampUint8(255.5)!==255||clampUint8(0/0)!==0)return 3;
 writeNumericElement(bytes,0,"Float16",1+1/2048,"little");if(readNumericElement(bytes,0,"Float16","little")!==1)return 4;
 writeNumericElement(bytes,0,"Float32",1.5,"big");if(readNumericElement(bytes,0,"Float32","big")!==1.5)return 5;
 writeNumericElement(bytes,0,"Float64",-0,"little");if(1/readNumericElement(bytes,0,"Float64","little")!==-1/0)return 6;
 writeNumericElement(bytes,0,"Int8",1/0,"little");if(bytes[0]!==0)return 7;
 return 42;
}`,
  "numeric-elements",
  [["elements", "packages/js-runtime/src/objects/numeric-element.ts"]],
);
