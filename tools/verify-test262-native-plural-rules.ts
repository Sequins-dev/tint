import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    `const en=new Intl.PluralRules("en");if(en.select(1)!=="one"||en.select(2)!=="other"||new Intl.PluralRules("en",{minimumFractionDigits:2}).select(1)!=="other")throw 1;if(new Intl.PluralRules("en",{type:"ordinal"}).select(22)!=="two")throw 2;`,
    `const ru=new Intl.PluralRules("ru");if(ru.select("900719925474099121")!=="one"||ru.select(900719925474099121n)!=="one"||ru.select("900719925474099111")!=="many")throw 1;let calls=0;const source={[Symbol.toPrimitive](hint){if(hint!=="number")throw 2;calls++;return "1";}};if(new Intl.PluralRules("en").select(source)!=="one"||calls!==1)throw 3;`,
    `if(new Intl.PluralRules("fr").select(1500000)!=="other"||new Intl.PluralRules("fr",{notation:"compact"}).select(1500000)!=="many")throw 1;if(new Intl.PluralRules("pt-PT").select(0)!=="other"||new Intl.PluralRules("pt-AO").select(0)!=="one")throw 2;`,
    `const en=new Intl.PluralRules("en");if(en.selectRange(1,1)!=="one"||en.selectRange(1,2)!=="other"||en.selectRange(1.0001,1.0002)!=="one")throw 1;let converted=false;try{en.selectRange({valueOf(){converted=true;return 1;}},undefined);throw 2;}catch(e){if(!(e instanceof TypeError)||converted)throw e;}try{en.selectRange(NaN,1);throw 3;}catch(e){if(!(e instanceof RangeError))throw e;}`,
    `let observed=false;const poison={valueOf(){observed=true;throw 1;}};for(const receiver of [Intl.PluralRules.prototype,new Proxy(new Intl.PluralRules(),{})]){try{Intl.PluralRules.prototype.select.call(receiver,poison);throw 2;}catch(e){if(!(e instanceof TypeError)||observed)throw e;}}const foreign=$262.createRealm().global;const f=new foreign.Intl.PluralRules("en");const result=Intl.PluralRules.prototype.resolvedOptions.call(f);if(Object.getPrototypeOf(result)!==Object.prototype||Object.getPrototypeOf(result.pluralCategories)!==Array.prototype)throw 3;`,
    `const f=new Intl.PluralRules("en",{minimumFractionDigits:2,maximumFractionDigits:2,roundingIncrement:25,roundingMode:"halfEven"});if(f.select(1.125)!=="other"||f.resolvedOptions().roundingIncrement!==25)throw 1;const values=Intl.PluralRules.supportedLocalesOf(["en-US-u-nu-arab","zxx"]);if(values.length!==1||values[0]!=="en-US-u-nu-arab")throw 2;`,
  ],
  { nodeReference: false },
);
