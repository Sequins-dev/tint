import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDate(2000,5,2);for(const mode of ["auto","never","always","critical"]){const suffix=mode==="always"?"[u-ca=iso8601]":mode==="critical"?"[!u-ca=iso8601]":"";if(d.toString({calendarName:mode})!=="2000-05-02"+suffix)throw 1;}if(d.toString({})!=="2000-05-02"||d.toString(undefined)!=="2000-05-02")throw 2;`,
    String.raw`const d=new Temporal.PlainDate(2000,5,2);let calls="";const options={get calendarName(){calls+="g";return {toString(){calls+="s";return "always";}};}};if(d.toString(options)!=="2000-05-02[u-ca=iso8601]"||calls!=="gs")throw 1;calls="";let caught=false;try{Temporal.PlainDate.prototype.toString.call({},options);}catch(e){caught=e instanceof TypeError;}if(!caught||calls!=="")throw 2;`,
    String.raw`const d=new Temporal.PlainDate(2000,5,2);for(const value of [null,true,1,"",1n,Symbol()]){let caught=false;try{d.toString(value);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;}for(const value of ["bad",null,true,1]){let caught=false;try{d.toString({calendarName:value});}catch(e){caught=e instanceof RangeError;}if(!caught)throw 2;}let caught=false;try{d.toString({calendarName:Symbol()});}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
  ],
  { nodeReference: false },
);
