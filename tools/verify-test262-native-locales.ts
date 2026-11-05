import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    `if(String(Intl.getCanonicalLocales(["iw-IL","he-il","EN-latn-us"]))!=="he-IL,en-Latn-US")throw 1;if(String(Intl.getCanonicalLocales("hy-SU"))!=="hy-AM")throw 2;`,
    `if(String(Intl.getCanonicalLocales("en-u-foo-foo-ca-islamicc-ca-gregory-kn-yes-ka-yes"))!=="en-u-foo-ca-islamic-civil-ka-yes-kn")throw 1;if(String(Intl.getCanonicalLocales("en-u-ca-islamicc-t-iw-m0-names-a-foo-x-BAR"))!=="en-a-foo-t-he-m0-prprname-u-ca-islamic-civil-x-bar")throw 2;`,
    `let log="";const source=new Proxy({length:2,0:"en",1:{toString(){log+="s;";return "fr";}}},{get(t,k,r){log+="g"+String(k)+";";return Reflect.get(t,k,r);},has(t,k){log+="h"+String(k)+";";return Reflect.has(t,k);}});if(String(Intl.getCanonicalLocales(source))!=="en,fr"||log!=="glength;h0;g0;h1;g1;s;")throw 1;`,
    `const source=Object.create({0:"en"});let reads=0;Object.defineProperty(source,"length",{get(){reads++;return 3;}});source[1]={toString(){delete source[2];return "fr";}};source[2]="de";if(String(Intl.getCanonicalLocales(source))!=="en,fr"||reads!==1)throw 1;const sentinel={};try{Intl.getCanonicalLocales({length:1,get 0(){throw sentinel;}});throw 2;}catch(e){if(e!==sentinel)throw e;}`,
    `for(const value of [null,[true],[1],[Symbol()], [0n]]){try{Intl.getCanonicalLocales(value);throw 1;}catch(e){if(!(e instanceof TypeError))throw e;}}for(const value of ["en_US","en-u-a0-foo","en-rozaj-ROZAJ"]){try{Intl.getCanonicalLocales(value);throw 2;}catch(e){if(!(e instanceof RangeError))throw e;}}for(const value of [undefined,true,1,Symbol(),0n])if(Intl.getCanonicalLocales(value).length!==0)throw 3;`,
    `const input=["iw","he"];Object.defineProperty(Array.prototype,"0",{set(){throw 1;},configurable:true});Array.prototype.push=function(){throw 2;};const result=Intl.getCanonicalLocales(input);if(result.length!==1||result[0]!=="he")throw 3;`,
  ],
  { nodeReference: false },
);
