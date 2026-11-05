import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// CLDR 49 collation metadata; $262 is required for method-realm checks.
// https://tc39.es/ecma402/#sec-collationsoflocale
verifyNativeScriptCases(
  [
    `const m=Intl.Locale.prototype.getCollations,d=Object.getOwnPropertyDescriptor(Intl.Locale.prototype,'getCollations');if(m.name!=='getCollations'||m.length!==0||d.enumerable||!d.writable||!d.configurable)throw 1;for(const tag of ['en-u-co','en-u-co-true','en-u-co-foobar','de-u-co-phonebk']){const l=new Intl.Locale(tag),a=l.getCollations();if(a.length!==1||a[0]!==l.collation)throw 2;}`,
    `for(const tag of ['en','de-DE','es-MX','zh-Hant','yue','qaa','und-DE']){const a=new Intl.Locale(tag).getCollations();if(a.length===0||String(a)!==String([...a].sort())||new Set(a).size!==a.length||a.includes('standard')||a.includes('search'))throw 1;}if(String(new Intl.Locale('de-DE').getCollations())!=='emoji,eor,phonebk'||String(new Intl.Locale('es-MX').getCollations())!=='emoji,eor,trad'||String(new Intl.Locale('und-DE').getCollations())!=='emoji,eor')throw 2;if(String(new Intl.Locale('yue').getCollations())!==String(new Intl.Locale('zh-Hant').getCollations()))throw 3;`,
    `const locale=new Intl.Locale('de'),first=locale.getCollations(),second=locale.getCollations();first[0]='changed';if(first===second||String(second)!=='emoji,eor,phonebk')throw 1;locale.toString=()=>{throw 2;};Object.defineProperty(Array.prototype,'0',{set(){throw 3;},configurable:true});Array.prototype.push=function(){throw 4;};if(locale.getCollations()[0]!=='emoji')throw 5;`,
    `const own=new Intl.Locale('en'),method=Intl.Locale.prototype.getCollations;for(const receiver of [undefined,null,42,'en',Intl.Locale.prototype,Object.create(own),new Proxy(own,{})]){let caught=false;try{method.call(receiver);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;}`,
    `const foreign=$262.createRealm().global,locale=new foreign.Intl.Locale('de');const own=Intl.Locale.prototype.getCollations.call(locale),other=foreign.Intl.Locale.prototype.getCollations.call(new Intl.Locale('en'));if(Object.getPrototypeOf(own)!==Array.prototype||Object.getPrototypeOf(other)!==foreign.Array.prototype||String(own)!=='emoji,eor,phonebk')throw 1;`,
  ],
  { nodeReference: false },
);
