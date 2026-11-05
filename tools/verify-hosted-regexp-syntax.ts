import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {parseRegExp,parseRegExpFlags} from "regexp";
import {createSourceText,type SourceText} from "source";
import {parseScript,rewriteModule} from "syntax";
function source(text:string):SourceText{const bytes=new TextEncoder().encode(text);const result=createSourceText(bytes,bytes.length);if(!result.ok)throw 99;return result.value;}
export function run():number {
 const flags=parseRegExpFlags("dgimsuy");if(!flags.ok||!flags.value.indices||!flags.value.unicode)return 1;
 if(parseRegExpFlags("uv").ok||parseRegExpFlags("gg").ok)return 2;
 const input="(a|b)+?[c-f]{2,4}";
 const parsed=parseRegExp(input,"u");if(!parsed.ok||parsed.value.captures!==1)return 3;
 const body=parsed.value.body;if(body.kind!=="sequence"||body.terms.length!==2)return 4;
 const first=body.terms[0];if(first===undefined||first.kind!=="repeat"||first.min!==1||first.greedy)return 5;
 const group=first.body;if(group.kind!=="group"||group.capture!==1||group.body.kind!=="alternation")return 6;
 const tail=body.terms[1];if(tail===undefined||tail.kind!=="repeat"||tail.min!==2||tail.max!==4)return 7;
 for(const text of ["(","[z-a]","a{4,2}","*a"]){if(text===undefined)throw 90;const result=parseRegExp(text,"");if(result.ok||result.error.kind!=="syntax")return 8;}
 const slash=String.fromCharCode(92);
 const ref=parseRegExp(slash+"1(a)","u");if(!ref.ok||ref.value.captures!==1)return 9;
 const legacy=parseRegExp(slash+"123","");if(!legacy.ok)return 10;const legacyBody=legacy.value.body;if(legacyBody.kind!=="character"||legacyBody.value!==83)return 10;
 const astral=parseRegExp(slash+"uD83D"+slash+"uDE00","u");if(!astral.ok)return 11;const astralBody=astral.value.body;if(astralBody.kind!=="character"||astralBody.value!==128512)return 11;
 const sets=parseRegExp("[a&&b]","v");if(!sets.ok)return 12;
 const script=parseScript(source("const f=(x=/[),}]/g)=>x; const n=10/2; /x/ / 2;"));
 if(!script.ok||script.value.statements.length!==3)return 13;
 const literal=parseScript(source("/[a-z]/gi;"));if(!literal.ok)return 14;
 const rewritten=rewriteModule(literal.value,{});
 const statement=rewritten.statements[0];if(statement===undefined||statement.kind!=="expression")return 15;
 const expression=statement.expression;if(expression.kind!=="regexp"||expression.pattern!=="[a-z]"||expression.flags!=="gi")return 16;
 const invalid=parseScript(source("/[z-a]/;"));if(invalid.ok||invalid.error.code!=="SYNTAX_ERROR")return 17;
 const setLiteral=parseScript(source("/x/v;"));if(!setLiteral.ok)return 18;
 const asyncError=parseScript(source("async()=>{(a=await/r/g)=>{}};"));if(asyncError.ok||asyncError.error.code!=="SYNTAX_ERROR")return 19;
 const forwardNamed=parseRegExp(slash+"1(?<name>a)","u");if(!forwardNamed.ok||forwardNamed.value.captures!==1||forwardNamed.value.names.length!==1)return 20;
 const scoped=parseRegExp("(?im-s:a(?-i:b))", "s");if(!scoped.ok||scoped.value.captures!==0||!scoped.value.flags.dotAll)return 21;
 const scopedBody=scoped.value.body;if(scopedBody.kind!=="modifiers"||scopedBody.enable!=="im"||scopedBody.disable!=="s")return 22;
 const repeated=parseRegExp("(?ii:a)","");if(repeated.ok||repeated.error.kind!=="syntax")return 23;
 const overlap=parseRegExp("(?i-i:a)","");if(overlap.ok||overlap.error.kind!=="syntax")return 24;
 const emptyModifiers=parseRegExp("(?-:a)","");if(emptyModifiers.ok||emptyModifiers.error.kind!=="syntax")return 25;
 const scopedLiteral=parseScript(source("/(?i:a(?-i:b))/;"));if(!scopedLiteral.ok)return 26;
 const named=parseRegExp("(?<x>a)|(?<x>b)","u");if(!named.ok||named.value.captures!==2||named.value.names.length!==2)return 27;
 const firstName=named.value.names[0];if(firstName===undefined||firstName.name!=="x"||firstName.capture!==1)return 28;
 const duplicate=parseRegExp("(?<x>a)(?<x>b)","");if(duplicate.ok||duplicate.error.kind!=="syntax")return 29;
 const escapedName=parseRegExp("(?<"+slash+"u{10400}>a)"+slash+"k<"+slash+"uD801"+slash+"uDC00>","");if(!escapedName.ok)return 30;
 const unknownName=parseRegExp(slash+"k<missing>","u");if(unknownName.ok||unknownName.error.kind!=="syntax")return 31;
 const namedLiteral=parseScript(source("/(?<x>a)|(?<x>b)/u;"));if(!namedLiteral.ok)return 32;
 const classNamed=parseRegExp("(?<a>x)["+slash+"k]","");if(classNamed.ok||classNamed.error.kind!=="syntax")return 33;
 const control=parseRegExp(slash+"c*","");if(!control.ok)return 34;
 const controlBody=control.value.body;if(controlBody.kind!=="sequence"||controlBody.terms.length!==2)return 35;
 const literalSlash=controlBody.terms[0];if(literalSlash===undefined||literalSlash.kind!=="character"||literalSlash.value!==92)return 36;
 const repeatedC=controlBody.terms[1];if(repeatedC===undefined||repeatedC.kind!=="repeat"||repeatedC.min!==0)return 37;
 const property=parseRegExp(slash+"P{scx=Grek}","u");if(!property.ok)return 38;
 const propertyBody=property.value.body;if(propertyBody.kind!=="class")return 39;
 const descriptor=propertyBody.entries[0];if(descriptor===undefined||descriptor.kind!=="property"||descriptor.property!=="Script_Extensions"||descriptor.value!=="Greek"||!descriptor.inverted||descriptor.strings)return 40;
 for(const name of ["ASCII","gc=Lu","Alpha","sc=Qaai","space","sc=Berf","scx=Sidetic","sc=Tayo","scx=Tolong_Siki"]){if(name===undefined)throw 90;if(!parseRegExp(slash+"p{"+name+"}","u").ok)return 41;}
 for(const name of ["WSpace","IsGreek","sc=latin","RGI_Emoji","gc=Lu=Ll"]){if(name===undefined)throw 90;const rejected=parseRegExp(slash+"p{"+name+"}","u");if(rejected.ok||rejected.error.kind!=="syntax")return 43;}
 const propertyRange=parseRegExp("[a-"+slash+"p{L}]","u");if(propertyRange.ok||propertyRange.error.kind!=="syntax")return 44;
 const complexSet=parseRegExp("[[a-z]--"+slash+"q{ab|cd|}]","v");if(!complexSet.ok||complexSet.value.flags.unicode||!complexSet.value.flags.unicodeSets)return 45;
 const setBody=complexSet.value.body;if(setBody.kind!=="unicode-set")return 46;
 const operation=setBody.body;if(operation.kind!=="subtraction"||operation.operands.length!==2)return 47;
 const strings=operation.operands[1];if(strings===undefined||strings.kind!=="strings"||strings.alternatives[0]!=="ab"||strings.alternatives[2]!=="")return 48;
 for(const input of ["[::]","[a&&b--c]","[^"+slash+"q{ab}]","[a-z&&b]",slash+"P{RGI_Emoji}"]){if(input===undefined)throw 90;const invalidSet=parseRegExp(input,"v");if(invalidSet.ok||invalidSet.error.kind!=="syntax")return 49;}
 const intersection=parseRegExp("[^"+slash+"q{ab}&&a]","v");if(!intersection.ok)return 50;
 const stringProperty=parseRegExp(slash+"p{RGI_Emoji}","v");if(!stringProperty.ok)return 51;
 return 42;
}`,
  "regexp-syntax",
  [
    ["regexp", "packages/foundation/src/regexp/syntax/index.ts"],
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
  ],
);
