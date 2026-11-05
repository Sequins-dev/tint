import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";

// Migrated from verify-construction: validate map semantics through the actual
// runtime graph, without coupling the checks to an obsolete allocation layout.
const cases = [
  {
    name: "source-maps",
    expected: 1,
    text: `
   interface Counter{calls:number}
   function receiver(m:Map<string,number>,c:Counter):Map<string,number>{c.calls=c.calls*10+1;return m;}
   function key(c:Counter):string{c.calls=c.calls*10+2;return "a";}
   function item(c:Counter):number{c.calls=c.calls*10+3;return 7;}
   function read(m:ReadonlyMap<string,number>):number{return m.get("a")??0;}
   function run(n:number):number {
     const strings=new Map<string,number>();const numbers=new Map<number,number>();const c:Counter={calls:0};
     if(receiver(strings,c).set(key(c),item(c)).set("b",2)!==strings||c.calls!==123)return -1;
     if(strings.size!==2||read(strings)!==7||strings.get("absent")!==undefined)return -2;
     numbers.set(0/0,3).set(-0,4).set(0/0,5).set(0,6);
     if(numbers.size!==2||(numbers.get(0/0)??0)!==5||(numbers.get(-0)??0)!==6)return -3;
     if(!strings.delete("a")||strings.has("a")||strings.delete("missing"))return -4;
     strings.clear();if(strings.size!==0||strings.has("b"))return -5;
     strings.set("final",9);if((strings.get("final")??0)!==9)return -6;
     return 1;
   }
 `,
  },
  {
    name: "source-map-fields",
    expected: 1,
    text: `
   interface Box {values:Map<string,number>}
   function run(n:number):number {
     const box:Box={values:new Map<string,number>()};
     box.values.set("a",1);const old=box.values;
     box.values=new Map<string,number>();box.values.set("b",2);
     if((old.get("a")??0)!==1||old.has("b"))return -1;
     if((box.values.get("b")??0)!==2||box.values.has("a"))return -2;
     return 1;
   }
 `,
  },
  {
    name: "source-object-map",
    expected: 1,
    text: `
    interface Key {id:number} interface Item {value:number}
    function get(map:ReadonlyMap<Key,Item>,key:Key):Item|undefined{return map.get(key);}
    function run(n:number):number {
      const map=new Map<Key,Item>();const a:Key={id:1},b:Key={id:1};
      const original:Item={value:7};map.set(a,original).set(b,{value:9});
      original.value=11;const found=get(map,a);
      if(found!==original||map.size!==2||map.get({id:1})!==undefined)return -1;
      const replacement:Item={value:13};map.set(a,replacement);
      if(get(map,a)!==replacement||original.value!==11||map.size!==2)return -2;
      if(!map.delete(b)||map.has(b)||map.size!==1)return -3;
      map.clear();if(map.size!==0||map.get(a)!==undefined)return -4;
      return 1;
    }
  `,
  },
  {
    name: "source-object-union-map",
    expected: 7,
    text: `
    type Item={readonly kind:"ok";value:number}|{readonly kind:"error";message:string};
    function run(n:number):number {
      const map=new Map<string,Item>();map.set("a",{kind:"ok",value:7}).set("b",{kind:"error",message:"hello"});
      const a=map.get("a"),b=map.get("b");
      if(a===undefined||b===undefined)return -1;
      if(a.kind!=="ok"||b.kind!=="error")return -2;
      if(a.value+b.message.length!==12)return -3;
      map.set("a",{kind:"error",message:"changed"});
      const replacement=map.get("a");if(replacement===undefined)return -4;
      if(replacement.kind!=="error")return -5;
      return replacement.message.length;
    }
  `,
  },
  {
    name: "source-object-map-types",
    expected: 12,
    text: `
    interface Item {value:number} interface Other {name:string}
    function run(n:number):number {
      const a=new Map<string,Item>(),b=new Map<string,Other>();
      a.set("key",{value:7});b.set("key",{name:"hello"});
      const x=a.get("key"),y=b.get("key");if(x===undefined||y===undefined)return -1;
      return x.value+y.name.length;
    }
  `,
  },
  {
    name: "source-string-maps",
    expected: 1,
    text: `
   function run(n:number):number {
     const numbers=new Map<string,number>();const texts=new Map<string,string>();
     numbers.set("name",7);texts.set("name","Tint").set("empty","");
     const owned="Ti"+"nt";texts.set("name",owned);
     if((numbers.get("name")??0)!==7||texts.get("name")!=="Tint"||texts.size!==2)return -1;
     const blank=texts.get("empty");if(blank)return -2;
     if((blank??"fallback")!==""||typeof blank!=="string")return -3;
     const missing=texts.get("absent");if(missing!==undefined||typeof missing!=="undefined")return -4;
     const name=texts.get("name");if(name===undefined)return -5;if(name.length!==4)return -6;
     texts.clear();texts.set("final","done");if(texts.get("final")!=="done"||texts.has("name"))return -7;
     return 1;
   }
 `,
  },
  {
    name: "generic-numeric-map",
    expected: 1,
    text: `
 function run(n:number):number {
   const map=createMap<string,number>();
   if(!setMap<string,number>(map,"a",1)||!setMap<string,number>(map,"b",2)||!setMap<string,number>(map,"c",3))return -1;
   if(setMap<string,number>(map,"b",20)||sizeMap<string,number>(map)!==3)return -2;
   if((getMap<string,number>(map,"b")??0)!==20||(getMap<string,number>(map,"missing")??99)!==99)return -3;
   if(!deleteMap<string,number>(map,"c")||!deleteMap<string,number>(map,"a")||deleteMap<string,number>(map,"missing"))return -4;
   if(sizeMap<string,number>(map)!==1||!hasMap<string,number>(map,"b"))return -5;
   clearMap<string,number>(map);if(hasMap<string,number>(map,"b")||sizeMap<string,number>(map)!==0)return -6;
   if(!setMap<string,number>(map,"final",7)||(getMap<string,number>(map,"final")??0)!==7)return -7;
   return 1;
 }
`,
  },
  {
    name: "custom-value-key-map",
    expected: 42,
    text: `
 interface Key { readonly id:number }
 function run(n:number):number {
   const map=createMapWithKeys<Key,number>({hash:(key:Key):number=>key.id%4,equals:(a:Key,b:Key):boolean=>a.id===b.id});
   setMap<Key,number>(map,{id:1},19);
   if(setMap<Key,number>(map,{id:1},23)||getMap<Key,number>(map,{id:1})!==23)return -1;
   for(let i=2;i<40;i++)setMap<Key,number>(map,{id:i},i);
   if(sizeMap<Key,number>(map)!==39||getMap<Key,number>(map,{id:1})!==23)return -2;
   if(!deleteMap<Key,number>(map,{id:1})||hasMap<Key,number>(map,{id:1})||getMap<Key,number>(map,{id:5})!==5)return -3;
   clearMap<Key,number>(map);setMap<Key,number>(map,{id:1},42);
   return getMap<Key,number>(map,{id:1})??-4;
 }
`,
  },
  {
    name: "generic-object-map",
    expected: 1,
    text: `
 interface Box {readonly value:number}
 function run(n:number):number {
   const first:Box={value:1};const second:Box={value:2};const map=createMap<number,Box>();
   if(!setMap<number,Box>(map,0/0,first)||!setMap<number,Box>(map,-0,first)||!setMap<number,Box>(map,1,second))return -1;
   if(setMap<number,Box>(map,0/0,second)||setMap<number,Box>(map,0,second)||sizeMap<number,Box>(map)!==3)return -2;
   const found=getMap<number,Box>(map,0/0);if(found===undefined)return -3;
   if(found!==second||found.value!==2||getMap<number,Box>(map,9)!==undefined)return -4;
   if(!deleteMap<number,Box>(map,0/0)||hasMap<number,Box>(map,0/0)||!hasMap<number,Box>(map,-0))return -5;
   clearMap<number,Box>(map);if(sizeMap<number,Box>(map)!==0)return -6;
   if(!setMap<number,Box>(map,2,first))return -7;
   return 1;
 }
`,
  },
  {
    name: "generic-undefined-map",
    expected: 1,
    text: `
   function run(n:number):number {
     const map=createMap<string,number|undefined>();
     if(!setMap<string,number|undefined>(map,"key",undefined))return -1;
     if(!hasMap<string,number|undefined>(map,"key")||getMap<string,number|undefined>(map,"key")!==undefined)return -2;
     if(hasMap<string,number|undefined>(map,"absent"))return -3;
     if(setMap<string,number|undefined>(map,"key",7)||(getMap<string,number|undefined>(map,"key")??0)!==7)return -4;
     if(setMap<string,number|undefined>(map,"key",undefined)||sizeMap<string,number|undefined>(map)!==1)return -5;
     return 1;
   }
 `,
  },
  {
    name: "source-nested-map",
    expected: 42,
    text: `function run(n:number):number{
   const outer=new Map<string,Map<string,number>>(),inner=new Map<string,number>();
   inner.set("value",42);outer.set("inner",inner);const found=outer.get("inner");
   if(found===undefined)return -1;return found.get("value")??0;
 }`,
  },
  {
    name: "source-map-optional-object",
    expected: 42,
    text: `interface Item {value:number}
    function run(n:number):number {const map=new Map<number,Item|undefined>();
      map.set(1,undefined);map.set(2,{value:42});const value=map.get(2);
      return map.has(1)&&value!==undefined?value.value:-1;}`,
  },
  {
    name: "source-automatic-collection-runtime",
    expected: 23,
    text: `interface Item {value:number}
function run(n:number):number {const a:Item={value:7};const list:Item[]=[a];const numbers:number[]=[2];const map=new Map<string,Item>();map.set("a",a);const set=new Set<Item>();set.add(a);let total=0;for(const item of set){if(item===undefined)return -1;total+=item.value;}const found=map.get("a"),item=list[0];if(found===undefined||item===undefined)return -1;return total+found.value+item.value+(numbers[0]??0);}`,
  },
  {
    name: "source-mixed-primitive-collections",
    expected: 18,
    text: `
    function run(n:number):number {
      const list:(number|string|boolean|undefined)[]=[7,"a",false,undefined];
      const set=new Set<number|string|boolean|undefined>();
      set.add(7);set.add("a");set.add(false);set.add(undefined);
      const map=new Map<string,number|string>();map.set("a",7);
      const first=list[0],found=map.get("a");
      if(typeof first!=="number"||typeof found!=="number")return -1;
      return first+found+set.size;
    }`,
  },
  {
    name: "source-map-iteration",
    expected: 205,
    text: `
    function run(n:number):number {
      const map=new Map<number,number>();map.set(1,1);map.set(2,2);map.set(3,3);
      let order=0,total=0;
      for(const [key,value] of map){order=order*10+key;total+=value;
        if(key===1){map.delete(2);map.set(2,20);map.set(3,30);}
        if(key===3){map.clear();map.set(4,40);}
      }
      return order+total;
    }
  `,
  },
  {
    name: "source-map-iteration-zero",
    expected: 1,
    text: `
    function run(n:number):number {
      const map=new Map<number,number>();map.set(-0,1);
      for(const [key,value] of map){if(1/key!==1/0)return -1;return value;}
      return -2;
    }
  `,
  },
  {
    name: "indexed-growth",
    expected: 42,
    text: `function run(n:number):number {
 const map=new Map<string,number>();
 for(let i=0;i<10000;i++)map.set(String(i),i);
 for(let i=0;i<10000;i++)if(map.get(String(i))!==i)return -1;
 for(let i=9999;i>=0;i--)if(!map.delete(String(i)))return -2;
 if(map.size!==0)return -3;
 map.set("Aa",1);map.set("BB",2);if(map.get("Aa")!==1||map.get("BB")!==2)return -4;
 let count=0;for(const [key,value] of map){count++;if(key==="Aa")map.set("later",3);}
 return count===3?42:-5;
}`,
  },
];
const modules = cases.map((item, index) => {
  const text =
    'import {createMap,createMapWithKeys,getMap,hasMap,setMap,deleteMap,clearMap,sizeMap} from "map";' +
    item.text.replace("function run(", "export function run(");
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return {
    id: "map-case-" + index,
    module: parsed.value,
    dependencies: new Map([
      ["map", "packages/foundation/src/collections/linked-map.ts"],
    ]),
  };
});
verifyHostedFixture(
  cases
    .map(
      (item, index) =>
        "import {run as case" + index + '} from "case' + index + '";',
    )
    .join("\n") +
    "export function run():number{" +
    cases
      .map(
        (item, index) =>
          "if(case" +
          index +
          "(0)!==" +
          item.expected +
          ")return " +
          (index + 1) +
          ";",
      )
      .join("") +
    "return 42;}",
  "indexed-maps",
  cases.map((item, index) => ["case" + index, "map-case-" + index]),
  modules,
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);
