import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `interface Link { readonly value:number; next:Link|undefined; }
function choose(first:Link,second:Link,flag:boolean):Link {const next=first.next;if(flag)return next===undefined?second:next;return first;}
function eight(a:Link,b:Link,c:Link,d:Link,e:Link,f:Link,g:Link,h:Link,flag:boolean):number {
 if(a.value!==1||b.value!==2||c.value!==3||d.value!==4||e.value!==5||f.value!==6||g.value!==7||h.value!==8)return 1;
 return flag?a.value*10+b.value+30:h.value*5+2;
}
function strings(first:string,second:string,link:Link):boolean {const next=link.next;return first===second&&next!==undefined&&next.value===1;}
function copy(destination:Uint32Array,source:Uint32Array,link:Link):number {const held=link;destination.set(source);return held.value;}
function optional(link:Link|undefined,other:Link):Link {return link===undefined?other:link;}
export function run():number {
 const a:Link={value:1,next:undefined},b:Link={value:2,next:a},c:Link={value:3,next:b},d:Link={value:4,next:c},e:Link={value:5,next:d},f:Link={value:6,next:e},g:Link={value:7,next:f},h:Link={value:8,next:g};
 if(eight(a,b,c,d,e,f,g,h,true)!==42||eight(a,b,c,d,e,f,g,h,false)!==42)return 1;
 if(choose(b,h,true)!==a||choose(b,h,false)!==b||choose(a,h,true)!==h)return 2;
 if(optional(undefined,h)!==h||optional(a,h)!==a)return 3;
 const text="o"+"ne";if(!strings(text,"one",b)||strings(text,"two",b)||strings(text,"one",a))return 4;
 const source=new Uint32Array(4),destination=new Uint32Array(4);source[0]=42;if(copy(destination,source,a)!==1||destination[0]!==42)return 5;
 for(let i=0;i<1000;i++){const garbage=new Uint32Array(40);garbage[0]=i;}
 if(choose(b,h,true)!==a||eight(a,b,c,d,e,f,g,h,false)!==42||!strings(text,"one",b))return 6;
 return 42;
}`,
  "leaf-references",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 32768,
    allocationCapacity: 4096,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
