import { verifyNativeScriptCases } from "./native-script-fixture.ts";

// ForLoopEvaluation disposes the initializer's environment after the entire
// loop, rather than after each iteration. Node 24 disagrees on continue/break.
verifyNativeScriptCases(
  [
    String.raw`let log="",i=0;for(using x={[Symbol.dispose](){log+="d";}};i<3;i++){log+=i;if(i===0)continue;if(i===1)break;}if(log!=="01d")throw 1;let caught;try{for(using a={[Symbol.dispose](){log+="a";}},b={get [Symbol.dispose](){throw 19;}};false;){}}catch(e){caught=e;}if(caught!==19||log!=="01da")throw 2;`,
    String.raw`let log="",i=0;for(using x={[Symbol.dispose](){log+="d";}};i<3;i++){log+=i;}if(log!=="012d")throw 1;`,
    String.raw`let log="";outer:for(let i=0;i<2;i++){for(using x={[Symbol.dispose](){log+="d";}};true;){log+="b";continue outer;}}if(log!=="bdbd")throw 1;`,
  ],
  { nodeReference: false },
);
