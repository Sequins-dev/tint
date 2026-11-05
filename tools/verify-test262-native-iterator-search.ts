import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    `const a={},b={};if(![NaN].values().includes(NaN)||![-0].values().includes(0)||![1n].values().includes(BigInt("1"))||![a].values().includes(a)||[a].values().includes(b))throw 1;if([19,23].values().includes(19,1)||![19,23].values().includes(23,1)||[19,23].values().includes(23,Infinity))throw 2;`,
    `for(const value of [NaN,1.1,"1",null,1n,{},-1,-Infinity,9007199254740992]){let next=0,closed=0;const it={get next(){next++;throw 1;},return(){closed++;throw 2;}};let caught;try{Iterator.prototype.includes.call(it,0,value);}catch(e){caught=e;}if(!(caught instanceof (typeof value==="number"&&(value<0||value>9007199254740991)?RangeError:TypeError))||next!==0||closed!==1)throw 3;}`,
    `let next=0,values=0,closed=0;const it={next(){next++;return next<=3?{done:false,get value(){values++;return next;}}:{done:true};},return(){closed++;return {};}};if(!Iterator.prototype.includes.call(it,3,2)||next!==3||values!==3||closed!==1)throw 1;const marker={};try{Iterator.prototype.includes.call({next(){return {done:false,value:42};},return(){throw marker;}},42);throw 2;}catch(e){if(e!==marker)throw 3;}`,
    `if([19,23].values().join()!=="19,23"||[undefined,null,1n,true].values().join("|")!=="||1|true"||[].values().join()!==""||[1,2].values().join("")!=="12")throw 1;let log="";const it={get next(){log+="n";return ()=>({done:true});}};const sep={toString(){log+="s";return ",";}};Iterator.prototype.join.call(it,sep);if(log!=="sn")throw 2;`,
    `const marker={};let read=0,closed=0;const it={get next(){read++;throw 1;},return(){closed++;throw 2;}};let caught;try{Iterator.prototype.join.call(it,{toString(){throw marker;}});}catch(e){caught=e;}if(caught!==marker||read!==0||closed!==1)throw 3;closed=0;try{Iterator.prototype.join.call({next(){return {done:false,value:Symbol()};},return(){closed++;throw 4;}});}catch(e){caught=e;}if(!(caught instanceof TypeError)||closed!==1)throw 5;`,
    `for(const name of ["includes","join"]){const marker={};let closed=0,caught;try{Iterator.prototype[name].call({next(){throw marker;},return(){closed++;return {};}});}catch(e){caught=e;}if(caught!==marker||closed!==0)throw 1;let calls=0;const it={next(){calls++;return {done:true};},return(){throw 2;}};Iterator.prototype[name].call(it);if(calls!==1)throw 3;}`,
  ],
  { nodeReference: false },
);
