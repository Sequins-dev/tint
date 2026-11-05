import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("foundation Unicode fixture requires TINT_BUILD_ONLY=1");
verifyHostedFixture(
  `import {isIDStart,isIDContinue,unicodeVersion as identifiersVersion} from 'identifiers';
import {hasUnicodeProperty,unicodePropertyRanges,containsUnicodeRangeSet,unicodeVersion as propertiesVersion} from 'properties';
import {unicodeLowercase,unicodeUppercase,unicodeVersion as casingVersion} from 'casing';
export function run():number {
 if(identifiersVersion!=='17.0.0'||propertiesVersion!=='17.0.0'||casingVersion!=='17.0.0')return 1;
 if(!isIDStart(65)||isIDStart(95)||!isIDContinue(95)||!isIDContinue(769)||isIDStart(55296))return 2;
 if(!isIDStart(0x088f)||!isIDStart(0x10940)||!isIDContinue(0xa7ce))return 3;
 if(isIDStart(-1)||isIDContinue(0.5)||isIDStart(0/0)||isIDContinue(0x110000))return 4;
 if(!hasUnicodeProperty('Script_Extensions','Hiragana',0x30fc)||hasUnicodeProperty('Script','Hiragana',0x30fc))return 5;
 if(!hasUnicodeProperty('Emoji_Presentation','',0x1f600)||!hasUnicodeProperty('General_Category','Surrogate',0xd800))return 6;
 if(unicodePropertyRanges('Script','NotAScript')!==undefined||unicodePropertyRanges('Script','Katakana_Or_Hiragana')!=='')return 7;
 const all=unicodePropertyRanges('Any');if(all===undefined||!containsUnicodeRangeSet(all,0x10ffff)||containsUnicodeRangeSet(all,0x110000))return 8;
 if(unicodeUppercase('Straße ﬃ')!=='STRASSE FFI')return 9;
 if(unicodeLowercase('ΟΣ')!=='ος'||unicodeLowercase('ΟΣ́')!=='ος́'||unicodeLowercase('ΟΣΑ')!=='οσα')return 10;
 if(unicodeLowercase(String.fromCodePoint(0xa7ce))!==String.fromCodePoint(0xa7cf)||unicodeUppercase(String.fromCodePoint(0x16ebb))!==String.fromCodePoint(0x16ea0))return 11;
 const unpaired=String.fromCharCode(55296)+'Ab'+String.fromCharCode(57343);
 if(unicodeLowercase(unpaired)!==String.fromCharCode(55296)+'ab'+String.fromCharCode(57343))return 12;
 if(unicodeUppercase('𐐨')!=='𐐀'||unicodeLowercase('𐐀')!=='𐐨')return 13;
 return 42;
}`,
  "foundation-unicode-v1",
  [
    ["identifiers", "packages/foundation/src/unicode/identifiers/index.ts"],
    ["properties", "packages/foundation/src/unicode/properties/index.ts"],
    ["casing", "packages/foundation/src/unicode/casing/index.ts"],
  ],
  [],
  [],
  [],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    runtimeEntry: "initializeCopyingRuntime",
  },
);
