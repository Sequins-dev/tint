import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`class D extends Temporal.Duration{}const d=new D(1,2,3,4,5,6,7,8,9,10),changed=d.with({days:12,seconds:undefined});if(changed===d||changed instanceof D||changed.days!==12||changed.years!==1||changed.seconds!==7||changed.nanoseconds!==10||d.days!==4)throw 1;const values=["P1D",{},null,3,{days:-1}];for(const value of values){let ok=false;try{d.with(value);}catch(e){ok=e instanceof TypeError||e instanceof RangeError;}if(!ok)throw 2;}let touched=false,ok=false;try{Temporal.Duration.prototype.with.call({}, {get days(){touched=true;return 1;}});}catch(e){ok=e instanceof TypeError;}if(!ok||touched)throw 3;const replacement=new Temporal.Duration();Object.defineProperty(replacement,"days",{get(){return 42;}});if(d.with(replacement).days!==42)throw 4;`,
  ],
  { nodeReference: false },
);
