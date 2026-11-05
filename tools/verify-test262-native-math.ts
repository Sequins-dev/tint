import { verifyNativeScriptCases } from "./native-script-fixture.ts";

const sources = [
  `if(parseInt('42tail')!==42||parseInt('0b10')!==0||parseInt('xyz',36)!==44027||parseInt('0x1000000000000081')!==1152921504606847200||!Object.is(parseInt('-0'),-0)||parseFloat('1e+tail')!==1||parseFloat('5e-324')!==5e-324||!Object.is(parseFloat('-0e999'),-0)||parseFloat('+Infinitytail')!==Infinity)throw 1;if(Number.parseInt!==parseInt||Number.parseFloat!==parseFloat)throw 2;`,
  `let log='';const text={toString(){log+='s';return '0x10!';}},radix={valueOf(){log+='r';return 16;}};if(parseInt(text,radix)!==16||log!=='sr')throw 1;let caught=false;try{parseInt(Symbol(),radix);}catch(e){caught=e instanceof TypeError;}if(!caught||log!=='sr')throw 2;if(!isFinite('1')||isFinite('Infinity')||!isNaN(undefined)||Number.isNaN('x')||Number.isFinite('1'))throw 3;`,
  `if(!Object.is(Math.abs(-0),0)||!Object.is(Math.sign(-0),-0)||!Object.is(Math.ceil(-0.1),-0)||!Object.is(Math.trunc(-0.1),-0)||!Object.is(Math.round(-0.5),-0)||!Object.is(Math.sqrt(-0),-0)||!Object.is(Math.sqrt(-1),NaN)||Math.floor(-0.1)!==-1||Math.round(0.49999999999999994)!==0||Math.sqrt(9)!==3)throw 1;`,
  `let log='';const a={valueOf(){log+='a';return NaN;}},b={valueOf(){log+='b';return 1;}};if(!Object.is(Math.max(a,b),NaN)||log!=='ab'||Math.min()!==Infinity||Math.max()!==-Infinity||!Object.is(Math.min(0,-0),-0)||!Object.is(Math.max(-0,0),0))throw 1;let caught=0;for(const name of ['abs','ceil','floor','trunc','round','sign','sqrt','clz32','min','max','imul']){try{Math[name](1n);}catch(e){if(e instanceof TypeError)caught++;}}if(caught!==11)throw 2;`,
  `if(Math.imul(0xffffffff,5)!==-5||Math.imul(0x80000000,2)!==0||Math.imul('7','6')!==42||Math.clz32(0)!==32||Math.clz32(1)!==31||Math.clz32(-1)!==0||Math.clz32(4294967297)!==31)throw 1;`,
];
verifyNativeScriptCases(sources);
