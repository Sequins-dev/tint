import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `interface Cell{register:number|"sp"|"zr";}
export function run():number{
 const cell:Cell={register:0};let sum=0;
 for(let n=0;n<3000000;n++){
  cell.register=n;const value=cell.register;
  if(typeof value!=="number")return 1;
  sum+=value;
 }
 return sum===4499998500000?42:2;
}`,
  "primitive-union-storage",
);
