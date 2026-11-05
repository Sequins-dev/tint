import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    `const values=Intl.supportedValuesOf("numberingSystem");if(values.length!==78||values.join()!==values.slice().sort().join()||!values.includes("latn"))throw 1;for(const system of values){const f=new Intl.NumberFormat("en",{numberingSystem:system});if(f.resolvedOptions().numberingSystem!==system||f.format(123)==="")throw 2;}if(values===Intl.supportedValuesOf("numberingSystem"))throw 3;`,
    `for(const [tag,expected] of [["en","latn"],["ar-EG","arab"],["en-u-nu-arab","arab"],["en-u-nu-foobar","foobar"],["en-u-nu",""]]){const f=new Intl.Locale(tag),value=f.getNumberingSystems();if(value.length!==1||value[0]!==expected||value===f.getNumberingSystems())throw tag;}try{Intl.Locale.prototype.getNumberingSystems.call({});throw 1;}catch(e){if(!(e instanceof TypeError))throw e;}`,
    `if((1234.5).toLocaleString("de")!=="1.234,5"||(1234567n).toLocaleString("hi-IN")!=="12,34,567")throw 1;let observed=false;const locales={get length(){observed=true;throw 2;}};for(const method of [Number.prototype.toLocaleString,BigInt.prototype.toLocaleString]){try{method.call({},locales);throw 3;}catch(e){if(!(e instanceof TypeError)||observed)throw e;}}if((9007199254740993n).toLocaleString("en",{useGrouping:false})!=="9007199254740993")throw 4;`,
    `const foreign=$262.createRealm().global;const result=foreign.Intl.Locale.prototype.getNumberingSystems.call(new Intl.Locale("en"));if(Object.getPrototypeOf(result)!==foreign.Array.prototype)throw 1;const values=foreign.Intl.supportedValuesOf("numberingSystem");if(Object.getPrototypeOf(values)!==foreign.Array.prototype)throw 2;Object.defineProperty(Array.prototype,"0",{set(){throw 3;},configurable:true});if(new Intl.Locale("en").getNumberingSystems()[0]!=="latn")throw 4;`,
  ],
  { nodeReference: false },
);
