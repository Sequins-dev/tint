import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceText,type SourceText} from "source";
import {createTokenScanner,scan,parseScript} from "syntax";
function source(text:string):SourceText {const bytes=new TextEncoder().encode(text);const s=createSourceText(bytes,bytes.length);if(!s.ok)throw 90;return s.value;}
export function run():number {
 const input=source('const x=42; /* comment */ x/2;');
 const tokens=scan(input);if(!tokens.ok)return 1;
 const stream=createTokenScanner(input);
 for(const expected of tokens.value){if(expected===undefined)throw 91;const actual=stream.next();if(!actual.ok||actual.value.kind!==expected.kind||actual.value.value!==expected.value||actual.value.start!==expected.start||actual.value.end!==expected.end)return 2;}
 const eof=stream.next();if(!eof.ok||eof.value.kind!=="eof")return 3;
 const invalid=createTokenScanner(source('x; "bad'));
 if(!invalid.next().ok||!invalid.next().ok)return 4;
 const error=invalid.next();if(error.ok||error.error.code!=="LEXICAL_ERROR")return 5;
 if(invalid.next().ok)return 6;
 const limited=createTokenScanner(source('x'),1);
 if(!limited.next().ok||limited.next().ok)return 7;
 if(!parseScript(input).ok)return 8;
 const reached=parseScript(source('const = 1; "bad'));
 if(reached.ok||reached.error.code!=="SYNTAX_ERROR"||reached.error.start!==6)return 9;
 const directive=parseScript(source('"use strict"; with({}){}'));
 if(directive.ok)return 10;
 const parameters=parseScript(source('function f(a = (1+2)){"use strict";}'));
 if(parameters.ok)return 11;
 const late=parseScript(source('const a=1; "bad'));
 if(late.ok||late.error.code!=="LEXICAL_ERROR")return 12;
 const regexp=createTokenScanner(source('/[}/]*/giu / 2'));
 const literal=regexp.next("regexp");
 if(!literal.ok||literal.value.kind!=="regexp"||literal.value.value!=="/[}/]*/giu")return 13;
 const division=regexp.next();if(!division.ok||division.value.kind!=="punctuation"||division.value.value!=="/")return 14;
 const badRegexp=createTokenScanner(source('/[abc/')).next("regexp");
 if(badRegexp.ok||badRegexp.error.code!=="LEXICAL_ERROR")return 15;
 const restartable=createTokenScanner(source('/* comment */ /[}]/g + 1'));
 const firstSlash=restartable.next();if(!firstSlash.ok)return 16;
 const restore=restartable.checkpoint();
 if(!restartable.next().ok)return 17;
 restore();
 const rescanned=restartable.rescanRegExp(firstSlash.value);
 if(!rescanned.ok||rescanned.value.kind!=="regexp"||rescanned.value.value!=="/[}]/g")return 18;
 const afterRegexp=restartable.next();if(!afterRegexp.ok||afterRegexp.value.value!=="+")return 19;
 restore();if(!restartable.rescanRegExp(firstSlash.value).ok)return 20;
 const badParameters=parseScript(source('function f(=1,a="bad'));
 if(badParameters.ok||badParameters.error.code!=="SYNTAX_ERROR"||badParameters.error.start!==11)return 21;
 const escapedPattern="/"+String.fromCharCode(92)+"d/g";
 const failedAhead=createTokenScanner(source(escapedPattern));
 const opening=failedAhead.next();if(!opening.ok)return 22;
 const beforeFailure=failedAhead.checkpoint();if(failedAhead.next().ok)return 23;
 beforeFailure();const recovered=failedAhead.rescanRegExp(opening.value);
 if(!recovered.ok||recovered.value.value!==escapedPattern)return 24;
 return 42;
}`,
  "token-scanner",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
  ],
);
