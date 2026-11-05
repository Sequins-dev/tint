import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {applyDescriptor,emptyUpdate} from "descriptor";
function same(left:number,right:number):boolean{return left===right?(left!==0||1/left===1/right):left!==left&&right!==right;}
export function run():number{
 const frozen=applyDescriptor<number>(undefined,true,{...emptyUpdate<number>(0),fields:1,value:-0},0,same);
 const descriptor=frozen.descriptor;if(frozen.status!=="accepted"||descriptor===undefined)return 1;
 if(applyDescriptor<number>(descriptor,true,{...emptyUpdate<number>(0),fields:1,value:0},0,same).status!=="rejected")return 2;
 if(applyDescriptor<number>(descriptor,true,{...emptyUpdate<number>(0),fields:1,value:-0},0,same).status!=="accepted")return 3;
 const initial=applyDescriptor<number>(undefined,true,{...emptyUpdate<number>(0),fields:33,value:NaN,configurable:true},0,same).descriptor;
 if(initial===undefined)return 4;
 const accessor=applyDescriptor<number>(initial,true,{...emptyUpdate<number>(0),fields:36,get:17,configurable:false},0,same).descriptor;
 if(accessor===undefined||!accessor.accessor||accessor.get!==17||accessor.value!==0||accessor.configurable)return 5;
 if(applyDescriptor<number>(accessor,true,{...emptyUpdate<number>(0),fields:4,get:18},0,same).status!=="rejected")return 6;
 if(applyDescriptor<number>(accessor,true,{...emptyUpdate<number>(0),fields:4,get:17},0,same).status!=="accepted")return 7;
 if(applyDescriptor<number>(undefined,false,emptyUpdate<number>(0),0,same).status!=="rejected")return 8;
 if(applyDescriptor<number>(initial,true,{...emptyUpdate<number>(0),fields:5},0,same).status!=="invalid")return 9;
 if(applyDescriptor<number>(initial,false,emptyUpdate<number>(0),0,same).descriptor!==initial)return 10;
 return 42;
}`,
  "descriptors",
  [["descriptor", "packages/js-runtime/src/descriptors/index.ts"]],
);
