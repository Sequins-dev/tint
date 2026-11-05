import { verifyNativeScriptCases } from "./native-script-fixture.ts";
const cases = [
  `for(const ms of [-8640000000000000,-123456789,0,123456789,8640000000000000]){const date=new Date(ms);date.valueOf=()=>{throw 1;};date[Symbol.toPrimitive]=()=>{throw 2;};const instant=date.toTemporalInstant();if(instant.epochNanoseconds!==BigInt(ms)*1000000n||Object.getPrototypeOf(instant)!==Temporal.Instant.prototype)throw 3;}`,
  `for(const value of [undefined,null,1,"x",{},[],Date.prototype,new Proxy(new Date(0),{})]){let caught=false;try{Date.prototype.toTemporalInstant.call(value);}catch(e){if(!(e instanceof TypeError))throw 1;caught=true;}if(!caught)throw 2;}let caught=false;try{new Date(NaN).toTemporalInstant();}catch(e){if(!(e instanceof RangeError))throw 3;caught=true;}if(!caught)throw 4;`,
  `class D extends Date{}const date=new D(123);const other=$262.createRealm().global;const instant=other.Date.prototype.toTemporalInstant.call(date);if(Object.getPrototypeOf(instant)!==other.Temporal.Instant.prototype||instant.epochNanoseconds!==123000000n)throw 1;`,
];
verifyNativeScriptCases(cases, { nodeReference: false });
