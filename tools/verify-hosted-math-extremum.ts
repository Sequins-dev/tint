import { verifyHostedFixture } from "./hosted-fixture.ts";

// Math.min/Math.max lower to pairwise FMIN/FMAX on numbers. The operands come
// from a typed array filled at run time, so no comparison folds: NaN anywhere
// wins, -0 orders below +0 in either position, one argument is returned as
// is, no arguments give the infinities, and every argument is evaluated in
// order. Integer results also bound loops and index typed arrays.
verifyHostedFixture(
  `
interface Calls {count:number;order:number}
function arg(c:Calls,v:Float64Array,i:number):number{c.count++;c.order=c.order*10+i;return v[i]??0;}
function negative(x:number):boolean{return 1/x<0;}
export function run():number {
 const v=new Float64Array(8);
 v[0]=0;v[1]=-0;v[2]=0/0;v[3]=3;v[4]=-5;v[5]=1/0;v[6]=-1/0;v[7]=2.5;
 const c:Calls={count:0,order:0};
 if(Math.min()!==1/0||Math.max()!==-1/0)return 1;
 if(!negative(Math.min(v[0]??1,v[1]??1))||!negative(Math.min(v[1]??1,v[0]??1)))return 2;
 if(negative(Math.max(v[0]??1,v[1]??1))||negative(Math.max(v[1]??1,v[0]??1)))return 3;
 if(!negative(Math.max(v[1]??1,v[1]??1))||negative(Math.min(v[0]??1,v[0]??1)))return 4;
 const low=Math.min(arg(c,v,3),arg(c,v,2),arg(c,v,4));
 const high=Math.max(arg(c,v,2),arg(c,v,3));
 if(low===low||high===high||c.count!==5||c.order!==32423)return 5;
 if(Math.min(v[5]??0,v[6]??0)!==-1/0||Math.max(v[6]??0,v[5]??0)!==1/0)return 6;
 if(Math.min(v[3]??0,v[4]??0,v[7]??0)!==-5||Math.max(v[3]??0,v[4]??0,v[7]??0)!==3)return 7;
 if(Math.min(v[7]??0)!==2.5||!negative(Math.max(v[1]??1))||Math.min(v[2]??0)===Math.min(v[2]??0))return 8;
 const n=v[3]??0,m=v[7]??0;
 const data=new Uint32Array(4);
 let total=0;
 for(let i=0;i<Math.min(n+1,data.length);i++){data[i]=Math.max(i,2);total+=data[i]??0;}
 if(total!==2+2+2+3||Math.min(m,n)!==2.5||Math.max(m,n)!==3)return 9;
 return 42;
}
`,
  "math-extremum",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 1048576,
    allocationCapacity: 65536,
    rootCapacity: 1024,
    stackBytes: 1048576,
  },
);
