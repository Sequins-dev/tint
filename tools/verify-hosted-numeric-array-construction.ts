import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `function source(values:readonly (number|undefined)[]):Float64Array{return new Float64Array(values);}
export function run():number {
 const values:(number|undefined)[]=[-1,256,65536,4294967297,NaN,Infinity,undefined,1.75];
 const u8=new Uint8Array(values),u16=new Uint16Array(values),u32=new Uint32Array(values),f64=source(values);
 if(u8.length!==8||u8[0]!==255||u8[1]!==0||u8[7]!==1)return 1;
 if(u16[0]!==65535||u16[1]!==256||u16[2]!==0)return 2;
 if(u32[0]!==4294967295||u32[2]!==65536||u32[3]!==1)return 3;
 if(f64[0]!==-1||f64[7]!==1.75||f64[4]===f64[4]||f64[6]===f64[6]||f64[5]!==Infinity)return 4;
 values[0]=99;if(u8[0]!==255)return 5;
 const holes:number[]=[];holes.length=4;holes[2]=42;
 const sparse=new Float64Array(holes),bytes=new Uint8Array(holes);
 if(sparse.length!==4||sparse[0]===sparse[0]||sparse[2]!==42||bytes[0]!==0||bytes[2]!==42)return 6;
 const empty=new Uint8Array([]),literal=new Uint16Array([42,65537]);
 if(empty.length!==0||literal[0]!==42||literal[1]!==1)return 7;
 let calls=0;function input():number[]{calls++;return [19,23];}
 const once=new Uint8Array(input());if(calls!==1||once[0]!==19||once[1]!==23)return 8;
 return 42;
}`,
  "numeric-array-construction",
);
