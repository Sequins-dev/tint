import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`let log="";{using a={[Symbol.dispose](){log+="a";}},b={[Symbol.dispose](){log+="b";}};log+="x";}if(log!=="xba")throw 1;`,
  String.raw`let log="";function f(){using a={[Symbol.dispose](){log+="d";}};log+="b";return 42;}if(f()!==42||log!=="bd")throw 1;`,
  String.raw`let caught;try{{using a={[Symbol.dispose](){throw 19;}},b={[Symbol.dispose](){throw 42;}};throw 9;}}catch(e){caught=e;}if(!(caught instanceof SuppressedError)||caught.error!==19||!(caught.suppressed instanceof SuppressedError)||caught.suppressed.error!==42||caught.suppressed.suppressed!==9)throw 1;`,
  String.raw`let log="",caught;try{{using a={[Symbol.dispose](){log+="a";throw 19;}};using b={get [Symbol.dispose](){throw 17;}};}}catch(e){caught=e;}if(log!=="a"||!(caught instanceof SuppressedError)||caught.error!==19||caught.suppressed!==17)throw 1;`,
  String.raw`let log="",caught=false;try{{using a={[Symbol.dispose](){log+="a";}};using b={get [Symbol.dispose](){return b;}};}}catch(e){caught=e instanceof ReferenceError;}if(!caught||log!=="a")throw 1;`,
  String.raw`let log="";for(let i=0;i<3;i++){using a={[Symbol.dispose](){log+=i;}};if(i===0)continue;if(i===1)break;}if(log!=="01")throw 1;function f(){using a={[Symbol.dispose](){throw 19;}};return 42;}let caught;try{f();}catch(e){caught=e;}if(caught!==19)throw 2;`,
  String.raw`let log="";const source={[Symbol.iterator](){let i=0;return {next(){return {done:i++>0,value:{[Symbol.dispose](){log+="d";}}};},return(){log+="r";return {done:true};}};}};for(using x of source){log+="b";break;}if(log!=="bdr")throw 1;for(using x of [{[Symbol.dispose](){log+="a";}},{[Symbol.dispose](){log+="c";}}]){continue;}if(log!=="bdrac")throw 2;`,
  String.raw`let log="";function*g(){using x={[Symbol.dispose](){log+="d";}};yield 1;log+="b";yield 2;}const i=g();if(i.next().value!==1||log!=="")throw 1;i.return();if(log!=="d")throw 2;function*h(){using x={[Symbol.dispose](){throw 42;}};yield 1;}const j=h();j.next();let caught;try{j.throw(19);}catch(e){caught=e;}if(!(caught instanceof SuppressedError)||caught.error!==42||caught.suppressed!==19)throw 3;`,
]);
