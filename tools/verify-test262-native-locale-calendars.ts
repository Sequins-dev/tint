import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// Preference data is pinned to CLDR 49; cross-realm cases require $262.
// https://tc39.es/ecma402/#sec-calendarsoflocale
verifyNativeScriptCases(
  [
    `const method=Intl.Locale.prototype.getCalendars,d=Object.getOwnPropertyDescriptor(Intl.Locale.prototype,'getCalendars');if(method.name!=='getCalendars'||method.length!==0||d.enumerable||!d.writable||!d.configurable)throw 1;for(const tag of ['en-u-ca','en-u-ca-true','en-u-ca-foobar','en-u-ca-islamicc']){const l=new Intl.Locale(tag),a=l.getCalendars();if(a.length!==1||a[0]!==l.calendar)throw 2;}`,
    `const expected=String(new Intl.Locale('en-TH').getCalendars());if(expected!=='buddhist,gregory')throw 1;for(const tag of ['en-u-sd-th10','en-US-u-rg-thzzzz','en-US-u-sd-usca-rg-thzzzz']){if(String(new Intl.Locale(tag).getCalendars())!==expected)throw 2;}if(String(new Intl.Locale('en-US-u-sd-th10').getCalendars())!=='gregory'||String(new Intl.Locale('th').getCalendars())!==String(new Intl.Locale('th-TH').getCalendars()))throw 3;`,
    `const available=Intl.supportedValuesOf('calendar');if(!available.includes('gregory')||!available.includes('iso8601')||available.includes('gregorian')||available.includes('islamicc'))throw 1;for(const tag of ['en','th','fa','ja','ar-SA','zh-CN']){const values=new Intl.Locale(tag).getCalendars();if(values.length===0)throw 2;for(const c of values){if(!available.includes(c))throw 3;}}if(String(available)!==String([...available].sort())||new Set(available).size!==available.length)throw 4;`,
    `const locale=new Intl.Locale('th-TH'),first=locale.getCalendars(),second=locale.getCalendars();first[0]='corrupted';if(first===second||String(second)!=='buddhist,gregory')throw 1;locale.toString=()=>{throw 2;};Object.defineProperty(Array.prototype,'0',{set(){throw 3;},configurable:true});Array.prototype.push=function(){throw 4;};if(locale.getCalendars()[0]!=='buddhist')throw 5;`,
    `const own=new Intl.Locale('en'),method=Intl.Locale.prototype.getCalendars;for(const receiver of [undefined,null,42,'en',Intl.Locale.prototype,Object.create(own),new Proxy(own,{})]){let caught=false;try{method.call(receiver);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;}`,
    `const foreign=$262.createRealm().global,locale=new foreign.Intl.Locale('th-TH');const own=Intl.Locale.prototype.getCalendars.call(locale),other=foreign.Intl.Locale.prototype.getCalendars.call(new Intl.Locale('en'));if(Object.getPrototypeOf(own)!==Array.prototype||Object.getPrototypeOf(other)!==foreign.Array.prototype||String(own)!=='buddhist,gregory')throw 1;`,
  ],
  { nodeReference: false },
);
