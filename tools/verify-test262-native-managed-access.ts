import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    `globalThis.tintAccess={child:{value:42}};const f=Function('return tintAccess.child.value');if(f()!==42)throw 1;globalThis.tintAccess={child:{value:19}};if(f()!==19)throw 2;`,
    `let log='';const leaf={get value(){if(this!==leaf)throw 1;log+='v';return 42;}};const root={get child(){if(this!==root)throw 2;log+='c';return leaf;}};Object.defineProperty(globalThis,'tintAccess',{configurable:true,get(){log+='r';return root;}});const f=Function('return tintAccess.child.value');if(f()!==42||log!=='rcv')throw 3;`,
    `const marker={};let reads=0;globalThis.tintAccess={get child(){throw marker;},get value(){reads++;return 1;}};const f=Function('return tintAccess.child.value');let caught;try{f();}catch(e){caught=e;}if(caught!==marker||reads!==0)throw 1;`,
    `for(const value of [null,undefined]){globalThis.tintAccess=value;const f=Function('return tintAccess.child');let caught=false;try{f();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;}globalThis.tintAccess={};if(Function('return tintAccess.child')()!==undefined)throw 2;`,
    `globalThis.tintAccess='abc';if(Function('return tintAccess.length')()!==3)throw 1;Object.defineProperty(Number.prototype,'tintValue',{configurable:true,get(){'use strict';if(this!==19)throw 2;return 42;}});globalThis.tintAccess=19;if(Function('return tintAccess.tintValue')()!==42)throw 3;`,
    `globalThis.tintAccess={'π':Object.create(null)};tintAccess['π']['__proto__']=42;const f=Function('return ((tintAccess)["π"])["__proto__"]');if(f()!==42)throw 1;`,
    `const child=$262.createRealm();child.global.tintAccess={child:{value:42}};globalThis.tintAccess={child:{value:19}};const f=child.global.Function('return tintAccess.child.value');if(f()!==42)throw 1;child.global.tintAccess=null;let caught=false;try{f();}catch(e){caught=e instanceof child.global.TypeError;}if(!caught)throw 2;`,
    `globalThis.tintAccess={get child(){return {marker:42,get value(){for(let i=0;i<60000;i++){const trash={a:i,b:i+1,c:[i]};if(trash.a!==i)throw 1;}return this.marker;}};}};const f=Function('return tintAccess.child.value');if(f()!==42||f()!==42)throw 2;`,
  ],
  { nodeReference: false },
);
