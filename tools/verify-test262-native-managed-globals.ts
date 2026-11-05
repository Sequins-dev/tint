import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    `var tintPlanet='Mars';const f=Function('return tintPlanet');if(f()!=='Mars')throw 1;tintPlanet='Venus';if(f()!=='Venus')throw 2;`,
    `const f=Function('return tintMissing');let caught=false;try{f();}catch(e){caught=e instanceof ReferenceError;}if(!caught)throw 1;globalThis.tintMissing=42;if(f()!==42)throw 2;delete globalThis.tintMissing;caught=false;try{f();}catch(e){caught=e instanceof ReferenceError;}if(!caught)throw 3;`,
    `var tintOuter=41;(function(){let tintOuter=99;const f=Function('return tintOuter');if(f()!==41)throw 1;})();`,
    `const f=Function('"use strict";return tintLexical');let caught=false;try{f();}catch(e){caught=e instanceof ReferenceError;}if(!caught)throw 1;let tintLexical=42;if(f()!==42)throw 2;tintLexical=43;if(f()!==43)throw 3;`,
    `const marker={value:42};Object.defineProperty(globalThis,'tintAccessor',{get(){throw marker;},configurable:true});const f=Function('return tintAccessor');let caught;try{f();}catch(e){caught=e;}if(caught!==marker)throw 1;`,
    `globalThis['π']=42;const f=Function('return \\u03c0');if(f()!==42)throw 1;`,
    `globalThis.tintParameter=1;const f=Function('tintParameter','return tintParameter');if(f(42)!==42)throw 1;`,
    `const child=$262.createRealm();child.global.tintRealmValue=99;globalThis.tintRealmValue=1;const f=child.global.Function('return tintRealmValue');if(f()!==99)throw 1;child.global.tintRealmValue=100;if(f()!==100)throw 2;`,
    `const child=$262.createRealm();child.global.tintRealmValue=99;globalThis.tintRealmValue=1;function Local(){}const f=Reflect.construct(child.global.Function,['return tintRealmValue'],Local);if(f()!==99||Object.getPrototypeOf(f)!==Local.prototype)throw 1;`,
  ],
  { nodeReference: false },
);
