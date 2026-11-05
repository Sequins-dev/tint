import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
export function run():number{
 const a=[true,false];if(a[0]!==true||a[1]!==false||a[2]!==undefined)return 1;
 if(a.push(false)!==3||a.pop()!==false)return 2;
 a.unshift(false);if(a.shift()!==false||a[0]!==true)return 3;
 a.reverse();if(a[0]!==false||a[1]!==true)return 4;
 const copy=a.slice();copy.fill(false);if(copy[1]!==false||a[1]!==true)return 5;
 if(a.indexOf(false)!==0||!a.includes(false)||a.indexOf(true)!==1)return 6;
 const sparse:(boolean|undefined)[]=[];sparse.length=4;sparse[1]=false;sparse[2]=undefined;
 if(sparse.indexOf(undefined)!==2||!sparse.includes(undefined)||sparse.at(1)!==false)return 7;
 sparse.reverse();if(sparse[2]!==false||sparse.indexOf(undefined)!==1)return 8;
 const mapped=a.map((value)=>!value);if(mapped[0]!==true||mapped[1]!==false)return 9;
 const filtered=a.filter((value)=>value===false);if(filtered.length!==1||filtered[0]!==false)return 10;
 if(!a.some((value)=>value===true)||a.every((value)=>value===true))return 11;
 const removed=sparse.splice(1,2,true);if(removed.length!==2||removed[0]!==undefined||removed[1]!==false||sparse[1]!==true)return 12;
 a.sort((left,right)=>left===right?0:left?1:-1);if(a[0]!==false||a[1]!==true)return 13;
 let count=0;for(const value of a){if(value===true)count++;}if(count!==1)return 14;
 if(a.join()!=="false,true"||sparse.join("-")!=="-true-")return 15;
 return 42;
}`,
  "boolean-lists",
);
