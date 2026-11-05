import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`if(new Date(0).toISOString()!=="1970-01-01T00:00:00.000Z")throw 1;if(new Date(-1).toISOString()!=="1969-12-31T23:59:59.999Z")throw 2;if(new Date(8640000000000000).toISOString()!=="+275760-09-13T00:00:00.000Z")throw 3;let caught=false;try{new Date(NaN).toISOString();}catch(e){caught=e instanceof RangeError;}if(!caught)throw 4;`,
  String.raw`const d=new Date(0);if(d.toUTCString()!=="Thu, 01 Jan 1970 00:00:00 GMT")throw 1;if(d.toGMTString!==d.toUTCString)throw 2;if(new Date(NaN).toUTCString()!=="Invalid Date")throw 3;if(new Date(-62198755200000).toUTCString()!=="Fri, 01 Jan -0001 00:00:00 GMT")throw 4;`,
  String.raw`const d=new Date(0);if(d.toJSON()!=="1970-01-01T00:00:00.000Z")throw 1;if(new Date(NaN).toJSON()!==null)throw 2;let order="";const x={valueOf(){order+="v";return 1;},get toISOString(){order+="g";return function(){if(this!==x||arguments.length!==0)throw 3;order+="c";return 17;};}};if(Date.prototype.toJSON.call(x)!==17||order!=="vgc")throw 4;`,
  String.raw`const x={toString(){return "text";},valueOf(){return 7;}};const p=Date.prototype[Symbol.toPrimitive];if(p.call(x,"default")!=="text"||p.call(x,"string")!=="text"||p.call(x,"number")!==7)throw 1;let caught=false;try{p.call(x,"bad");}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
]);
