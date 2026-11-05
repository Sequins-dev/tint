import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDate(2000,2,29);if(d.toPlainDateTime().toString()!=="2000-02-29T00:00:00"||d.toPlainDateTime("12:34:56.987654321").toString()!=="2000-02-29T12:34:56.987654321"||d.toPlainDateTime({hour:25}).hour!==23)throw 1;const t=new Temporal.PlainTime(12);Object.defineProperty(t,"hour",{get(){throw 2;}});if(d.toPlainDateTime(t).hour!==12)throw 3;class D extends Temporal.PlainDate{}const sub=new D(2020,3,2);Object.defineProperty(sub,"year",{get(){throw 4;}});if(sub.toPlainDateTime().year!==2020||!(sub.toPlainDateTime() instanceof Temporal.PlainDateTime))throw 5;`,
    String.raw`const d=new Temporal.PlainDate(-271821,4,19);let ok=false;try{d.toPlainDateTime();}catch(e){ok=e instanceof RangeError;}if(!ok)throw 1;if(d.toPlainDateTime("00:00:00.000000001").nanosecond!==1)throw 2;let touched=false;ok=false;try{Temporal.PlainDate.prototype.toPlainDateTime.call({}, {get hour(){touched=true;return 12;}});}catch(e){ok=e instanceof TypeError;}if(!ok||touched)throw 3;for(const value of [null,{},"12Z"]){ok=false;try{new Temporal.PlainDate(2000,1,1).toPlainDateTime(value);}catch(e){ok=e instanceof TypeError||e instanceof RangeError;}if(!ok)throw 4;}`,
  ],
  { nodeReference: false },
);
