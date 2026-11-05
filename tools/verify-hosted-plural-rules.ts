import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {createPluralRuleSet,createPluralOperands,selectPluralCategory,selectPluralRange} from "plural";
function selected(locale:string,text:string,type:"cardinal"|"ordinal",exponent:number):string {
 const rules=createPluralRuleSet(locale,type),operands=createPluralOperands(text,exponent);
 if(rules===undefined||operands===undefined)return "invalid";
 return selectPluralCategory(rules,operands);
}
export function run():number {
 if(selected("en","1","cardinal",0)!=="one"||selected("en","1.00","cardinal",0)!=="other")return 1;
 if(selected("ru","900719925474099121","cardinal",0)!=="one"||selected("ru","900719925474099111","cardinal",0)!=="many")return 2;
 if(selected("fr","1.5","cardinal",6)!=="many"||selected("fr","1500000","cardinal",0)!=="other")return 3;
 if(selected("pt-PT","0","cardinal",0)!=="other"||selected("pt-AO","0","cardinal",0)!=="one")return 4;
 if(selected("en","22","ordinal",0)!=="two"||selected("ar","3","cardinal",0)!=="few")return 5;
 if(selected("sl","1.2","cardinal",0)!=="few"||selected("cy","6","cardinal",0)!=="many")return 6;
 const de=createPluralRuleSet("de","cardinal"),en=createPluralRuleSet("en","cardinal");
 if(de===undefined||en===undefined||selectPluralRange(de,"other","one")!=="one"||selectPluralRange(en,"other","one")!=="other")return 7;
 return 42;
}`,
  "plural-rules",
  [["plural", "packages/js-runtime/src/objects/plural-rules.ts"]],
);
