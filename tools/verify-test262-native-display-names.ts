import { verifyNativeScriptCases } from "./native-script-fixture.ts";

// Native Intl.DisplayNames: construction, every type, styles, fallback,
// brand checks and resolvedOptions, compared with Node where Node's ICU data
// agrees with the pinned CLDR 49 en table.
verifyNativeScriptCases(
  [
    String.raw`const d=new Intl.DisplayNames("en",{type:"region"});if(d.of("GB")!=="United Kingdom"||d.of("gb")!=="United Kingdom"||d.of("419")!=="Latin America")throw 1;if(new Intl.DisplayNames("en",{type:"region",style:"short"}).of("GB")!=="UK")throw 2;`,
    String.raw`const l=new Intl.DisplayNames("en",{type:"language"});if(l.of("en-GB")!=="British English"||l.of("zh-Hant")!=="Traditional Chinese")throw 1;if(new Intl.DisplayNames("en",{type:"language",languageDisplay:"standard"}).of("en-GB")!=="English (United Kingdom)")throw 2;`,
    String.raw`const s=new Intl.DisplayNames("en",{type:"script"}),c=new Intl.DisplayNames("en",{type:"currency"}),f=new Intl.DisplayNames("en",{type:"dateTimeField"}),k=new Intl.DisplayNames("en",{type:"calendar"});if(s.of("latn")!=="Latin"||c.of("usd")!=="US Dollar"||f.of("timeZoneName")!=="time zone"||k.of("gregory")!=="Gregorian Calendar")throw 1;`,
    String.raw`const d=new Intl.DisplayNames("en",{type:"region",fallback:"none"});if(d.of("AA")!==undefined)throw 1;if(new Intl.DisplayNames("en",{type:"region"}).of("aa")!=="AA")throw 2;for(const bad of ["a","aaa","1111"]){let r=false;try{d.of(bad);}catch(e){r=e instanceof RangeError;}if(!r)throw 3;}`,
    String.raw`let t=false;try{new Intl.DisplayNames("en");}catch(e){t=e instanceof TypeError;}if(!t)throw 1;t=false;try{Intl.DisplayNames("en",{type:"region"});}catch(e){t=e instanceof TypeError;}if(!t)throw 2;t=false;try{Intl.DisplayNames.prototype.of.call({},"GB");}catch(e){t=e instanceof TypeError;}if(!t)throw 3;const o=new Intl.DisplayNames("en-US",{type:"language",style:"short"}).resolvedOptions();if(Object.keys(o).join()!=="locale,style,type,fallback,languageDisplay"||o.locale!=="en-US")throw 4;if(Object.prototype.toString.call(new Intl.DisplayNames("en",{type:"region"}))!=="[object Intl.DisplayNames]")throw 5;`,
  ],
  { nodeReference: false },
);
