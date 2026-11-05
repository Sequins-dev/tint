import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
function format(s:string,n:number,b:boolean,u:undefined,z:null):string {
 return \`head:\${s}:\${n}:\${b}:\${u}:\${z}:tail\`;
}
function capture(s:string):()=>string {return ()=>\`value:\${s}\`;}
export function run():number {
 if(format("x",42,true,undefined,null)!=="head:x:42:true:undefined:null:tail")return 1;
 if(format("",-0,false,undefined,null)!=="head::0:false:undefined:null:tail")return 2;
 if(capture("42")()!=="value:42")return 3;
 let i=0;
 if(\`\${i++}:\${i++}:\${i}\`!=="0:1:2")return 4;
 let String=():string=>"wrong";
 if(\`\${42}\`!=="42")return 5;
 return 42;
}
`,
  "typed-templates",
  [],
);
