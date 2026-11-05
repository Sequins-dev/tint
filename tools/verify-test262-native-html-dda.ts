import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=$262.IsHTMLDDA;if(d===undefined||d===null||typeof d!=="undefined"||Boolean(d)||!!d)throw 1;if(!(d==null)||!(null==d)||!(d==undefined)||!(undefined==d))throw 2;if(d!==d||!Object.is(d,d)||d()===(void 0)||d("")!==null)throw 3;let n=0;if(d)n++;if(d?true:false)n++;while(d)n++;if(n!==0||(d||42)!==42||(d&&42)!==d||(d??42)!==d)throw 4;`,
    String.raw`const d=$262.IsHTMLDDA;let calls=0;d.valueOf=function(){calls++;return 0;};if(d==null&&calls!==0)throw 1;if(!(d==0)||calls!==1)throw 2;const p=new Proxy(d,{});if(!Boolean(p)||typeof p!=="function"||p==null||p==undefined||p()!==null)throw 3;const child=Object.create(d);if(!Boolean(child)||typeof child!=="object"||child==null)throw 4;const r=Proxy.revocable(d,{});r.revoke();if(!Boolean(r.proxy)||typeof r.proxy!=="function"||r.proxy==null)throw 5;`,
    String.raw`const d=$262.IsHTMLDDA,o={};Object.defineProperty(o,"x",{value:42,writable:d,enumerable:d,configurable:d});const desc=Object.getOwnPropertyDescriptor(o,"x");if(desc.writable||desc.enumerable||desc.configurable)throw 1;if([1].filter(()=>d).length!==0||[1].some(()=>d)||[1].every(()=>d))throw 2;const iterator={i:0,next(){return this.i++===0?{value:42,done:d}:{done:true};},[Symbol.iterator](){return this;}};if(Array.from(iterator)[0]!==42)throw 3;`,
    String.raw`const d=$262.IsHTMLDDA;for(const pair of [["match",Symbol.match],["matchAll",Symbol.matchAll],["search",Symbol.search],["split",Symbol.split]]){Object.defineProperty(d,pair[1],{value:d,configurable:true});if(""[pair[0]](d)!==null)throw 1;delete d[pair[1]];}Object.defineProperty(d,Symbol.replace,{value:d,configurable:true});if("".replace(d,"")!==null||"".replaceAll(d,"")!==null)throw 2;`,
  ],
  { nodeReference: false },
);
