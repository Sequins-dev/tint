import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import {
  createNativeBatchBuilder,
  prepareNativeScripts,
} from "./test262-native.ts";
import { executionPlan } from "./test262-execution.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
  readWorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Build only; execute through the serial LLDB fixture recorder",
);
// Shared Script prelude: an object whose conversion methods append to `t`.
const prelude =
  "var t='';function E(){}" +
  "function o(n,v){return{valueOf:function(){t+=n;if(v===E)throw new E();return v;}};}" +
  "function threw(f,C){try{f();}catch(e){return e instanceof C;}return false;}";
const sources = [
  {
    name: "addition converts both operands before ToNumeric (ECMA-262 13.15.3)",
    source:
      "t='';if(!threw(function(){o('l',Symbol())+o('r',E)},E)||t!=='lr')throw 1;" +
      "t='';if(!threw(function(){o('l',1)+o('r',Symbol())},TypeError)||t!=='lr')throw 2;" +
      "if(o('l',1)+o('r','2')!=='12')throw 3;if(10n+'!'!=='10!')throw 4;",
  },
  {
    name: "non-additive operators finish ToNumeric(lhs) first",
    source:
      "var ops=['-','*','/','%','**','&','|','^','<<','>>','>>>'];for(var i=0;i<ops.length;i++){" +
      "var f=Function('a','b','return a '+ops[i]+' b');" +
      "t='';if(!threw(function(){f(o('l',Symbol()),o('r',E))},TypeError)||t!=='l')throw 10+i;" +
      "t='';if(!threw(function(){f(o('l',1n),o('r',1))},TypeError)||t!=='lr')throw 30+i;}",
  },
  {
    name: "relational operators convert left then right with number hint",
    source:
      "var h=[];var p={[Symbol.toPrimitive]:function(x){h.push(x);return 1;}};" +
      "if(!(p<2)||p>2||!(p<=1)||!(p>=1)||h.join()!=='number,number,number,number')throw 50;" +
      "t='';if(!threw(function(){o('l',Symbol())<o('r',E)},E)||t!=='lr')throw 51;" +
      "t='';if(!threw(function(){o('l',Symbol())>o('r',E)},E)||t!=='lr')throw 52;",
  },
  {
    name: "BigInt relational and equality comparisons are exact",
    source:
      "if(!(9007199254740993n>9007199254740992)||9007199254740992==9007199254740993n)throw 60;" +
      "if(1n<NaN||1n>NaN||!(1n<Infinity)||!(-Infinity<-1n)||!(0n<=-0)||!(0n==-0))throw 61;" +
      "if(!(16n<='0x10')||1n<'1.5'||1n>='1.5'||'1n'<=1n||!(0n=='')||!(1n=='0x1')||1n=='1n')throw 62;" +
      "if(!(1n==true)||!(0n==false)||0n==null||0n==undefined||!(2n==Object(2n)))throw 63;",
  },
  {
    name: "ToPrimitive validates @@toPrimitive before ordinary conversion",
    source:
      "var vals=[1,'f',true,{}];for(var i=0;i<vals.length;i++){t='';var x=o('v',3);x[Symbol.toPrimitive]=vals[i];" +
      "if(!threw(function(){+x},TypeError)||t!=='')throw 70+i;}" +
      "t='';var y=o('v',3);y[Symbol.toPrimitive]=null;if(+y!==3||t!=='v')throw 75;" +
      "var z={[Symbol.toPrimitive]:function(){return {};},valueOf:function(){throw 76;}};if(!threw(function(){z+''},TypeError))throw 77;" +
      "var g={get [Symbol.toPrimitive](){throw new E();}};if(!threw(function(){g==1},E))throw 78;" +
      "var s=Symbol(),w={[Symbol.toPrimitive]:function(hint){if(hint!=='default')throw 79;return s;}};if(!(s==w)||!(w==s))throw 80;",
  },
  {
    name: "unary and update operators distinguish ToNumber from ToNumeric",
    source:
      "if(!threw(function(){+1n},TypeError)||-0n!==0n||~-1n!==0n||!Object.is(-'',-0))throw 90;" +
      "t='';var a=o('a','41'),b=a++;if(b!==41||a!==42||t!=='a')throw 91;" +
      "var c=0n,d=c--;if(d!==0n||c!==-1n)throw 92;var n=null;n++;if(n!==1)throw 93;" +
      "var q=Symbol();if(!threw(function(){q++},TypeError))throw 94;" +
      "if(!threw(function(){1n>>>0n},TypeError)||!threw(function(){1n/0n},RangeError)||!threw(function(){2n**-1n},RangeError))throw 95;",
  },
  {
    name: "string numeric literal and number formatting boundaries",
    source:
      "if(+'  0x1F\\n'!==31||!Object.is(+'-0',-0)||+'\\u00A0\\uFEFF'!==0||+'\\u2028\\u20291\\u3000'!==1)throw 100;" +
      "if(+'1_0'===+'1_0'||+'-0x1'===+'-0x1'||+'infinity'===+'infinity'||+'+Infinity'!==Infinity||+'\\u180E1'===+'\\u180E1')throw 101;" +
      "if(+'1e400'!==Infinity||!Object.is(+'-1e-400',-0)||+'.5'!==0.5||+'5.'!==5||+'.'===+'.'||+'0b11'!==3||+'0o17'!==15)throw 102;" +
      "if(''+1e21!=='1e+21'||''+1e-7!=='1e-7'||''+(-0)!=='0'||''+123e-20!=='1.23e-18'||''+5e-324!=='5e-324'||''+0.1+0.2!=='0.10.2')throw 103;" +
      "if((2**32+1|0)!==1||(-1>>>0)!==4294967295||(1e21|0)!==-559939584||(NaN|0)!==0||(1<<33)!==2||(-5.5%2)!==-1.5||!Object.is(-0%1,-0))throw 104;",
  },
  {
    // Case 1 semantics without runtime Function compilation, whose native
    // dynamic-compilation cost exceeded the containment budget.
    name: "non-additive operators finish ToNumeric(lhs) first (static operator functions)",
    source:
      "var fs=[function(a,b){return a-b},function(a,b){return a*b},function(a,b){return a/b},function(a,b){return a%b}," +
      "function(a,b){return a**b},function(a,b){return a&b},function(a,b){return a|b},function(a,b){return a^b}," +
      "function(a,b){return a<<b},function(a,b){return a>>b},function(a,b){return a>>>b}];for(var i=0;i<fs.length;i++){var f=fs[i];" +
      "t='';if(!threw(function(){f(o('l',Symbol()),o('r',E))},TypeError)||t!=='l')throw 110+i;" +
      "t='';if(!threw(function(){f(o('l',1n),o('r',1))},TypeError)||t!=='lr')throw 130+i;}",
  },
];
const cases = sources.map(({ name, source: body }) => {
  const source = prelude + body;
  // Node reference only: native acceptance is the separate LLDB recording.
  runInContext(source, createContext());
  const prepared = prepareNativeScripts(
    executionPlan(source, "raw", {
      flags: ["raw"],
      features: [],
      includes: [],
    }),
    "raw",
    [],
  );
  assert.ok(prepared.ok, name + ": " + JSON.stringify(prepared));
  return { scripts: prepared.modules, asynchronous: false };
});
const captured = process.env.TINT_TEST262_SOURCES;
const snapshot =
  captured === undefined
    ? workspaceSources()
    : readWorkspaceSourceSnapshot(captured);
const built = createNativeBatchBuilder(snapshot)(cases);
if (!built.ok) throw Error(JSON.stringify(built.outcome));
const directory = mkdtempSync(join(tmpdir(), "tint-native-operator-coercion-")),
  binary = join(directory, "operator-coercion"),
  fixture = join(directory, "cases.json");
writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
writeFileSync(
  fixture,
  JSON.stringify(
    {
      kind: "native-operator-coercion-fixture",
      conformance: false,
      prelude,
      cases: sources.map((item) => ({
        ...item,
        expected: { kind: "completed" },
      })),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
writeFileSync(
  binary + ".manifest.json",
  JSON.stringify(
    {
      kind: "tint-hosted-native-build",
      version: 1,
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      imageSha256: createHash("sha256").update(built.bytes).digest("hex"),
      fixture,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(binary);
