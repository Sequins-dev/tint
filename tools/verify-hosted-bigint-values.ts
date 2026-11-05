import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {objectPropertyKey,looselyEqual,binaryObjectValueOperation,objectValueTypeof,stringValue,unaryObjectValueOperation,createErrorRealm,type ObjectHooks,bigIntToBoolean,compareBigIntValues,compareBigIntNumber,compareBigIntString,bigIntFromString,bigIntToString,bigIntBinaryOperation,bigIntUnaryOperation,viewBigIntValue,viewObjectValue,viewSymbolValue,createObject,type ScriptPropertyKey,type BigIntValue} from "object";
function value(text:string):BigIntValue {const result=bigIntFromString(text);if(result===undefined)throw 91;return result;}
export function run():number {
 const a=value("  0xffffffffffffffff  "),b=value("1");
 if(viewBigIntValue(a)!==a||viewBigIntValue("1")!==undefined||viewBigIntValue(undefined)!==undefined)return 1;
 const object=createObject<ScriptPropertyKey,unknown>(undefined);
 if(viewBigIntValue(object)!==undefined||viewObjectValue(a,object)!==undefined||viewSymbolValue(a)!==undefined)return 2;
 const sum=bigIntBinaryOperation("+",a,b,64),result=sum.value;
 if(sum.error!=="none"||result===undefined||bigIntToString(result,10)!=="18446744073709551616")return 3;
 const shifted=bigIntBinaryOperation(">>",value("-3"),value("100000000000000000000000000000000000"),64),shiftedValue=shifted.value;
 if(shifted.error!=="none"||shiftedValue===undefined||bigIntToString(shiftedValue,10)!=="-1")return 4;
 if(bigIntBinaryOperation("/",a,value("0"),64).error!=="range")return 5;
 if(bigIntBinaryOperation(">>>",a,b,64).error!=="type"||bigIntUnaryOperation("+",a,64).error!=="type")return 6;
 if(bigIntFromString("-0x1")!==undefined||bigIntFromString("1n")!==undefined||bigIntFromString("0x+1")!==undefined)return 7;
 const blank=value(String.fromCharCode(0xfeff)+String.fromCharCode(0x2028));
 if(bigIntToString(blank,10)!=="0")return 8;
 if(bigIntToBoolean(value("0"))||!bigIntToBoolean(value("-1")))return 9;
 if(compareBigIntValues(a,value("18446744073709551615"))!==0||compareBigIntNumber(value("9007199254740993"),9007199254740992)!==1||compareBigIntNumber(a,NaN)!==undefined)return 10;
 if(compareBigIntString(a,"18446744073709551615")!==0||compareBigIntString(a,"1.0")!==undefined)return 11;
 if(objectValueTypeof(a,object)!=="bigint")return 12;
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(x,y):boolean=>x===y,call:(callee,receiver,args):unknown=>{throw "UNEXPECTED_CALL";}};
 const realm=createErrorRealm(object,hooks);
 const string=stringValue(a,hooks,realm);
 if(string.error!=="none"||string.value!=="18446744073709551615")return 14;
 if(unaryObjectValueOperation("+",a,hooks,realm).error!=="type")return 15;
 const key=objectPropertyKey(object,a,hooks,realm);
 if(key.error!=="none"||key.value!=="18446744073709551615")return 16;
 if(!looselyEqual(a,value("18446744073709551615"),hooks,realm).value)return 17;
 if(looselyEqual(value("9007199254740993"),9007199254740992,hooks,realm).value)return 18;
 if(!looselyEqual(value("1"),true,hooks,realm).value||!looselyEqual("0x10",value("16"),hooks,realm).value)return 19;
 if(looselyEqual(value("0"),null,hooks,realm).value||looselyEqual(value("1"),"1.0",hooks,realm).value)return 20;
 const greater=binaryObjectValueOperation(">",value("9007199254740993"),9007199254740992,hooks,realm);
 if(greater.error!=="none"||greater.value!==true)return 21;
 const unordered=binaryObjectValueOperation("<=",a,NaN,hooks,realm);
 if(unordered.error!=="none"||unordered.value!==false)return 22;
 const reversed=binaryObjectValueOperation("<","0x10",value("17"),hooks,realm);
 if(reversed.error!=="none"||reversed.value!==true)return 23;
 const sumScript=binaryObjectValueOperation("+",a,b,hooks,realm),sumValue=viewBigIntValue(sumScript.value);
 if(sumScript.error!=="none"||sumValue===undefined||bigIntToString(sumValue,10)!=="18446744073709551616")return 24;
 for(const op of ["+","-","*","/","%","**","&","|","^","<<",">>",">>>"]) {
  if(op===undefined)throw 90;
  if(binaryObjectValueOperation(op,a,1,hooks,realm).error!=="type"||binaryObjectValueOperation(op,1,a,hooks,realm).error!=="type")return 25;
 }
 if(binaryObjectValueOperation("+","a",a,hooks,realm).value!=="a18446744073709551615"||binaryObjectValueOperation("+",a,"b",hooks,realm).value!=="18446744073709551615b")return 26;
 if(binaryObjectValueOperation("/",a,value("0"),hooks,realm).error!=="range"||binaryObjectValueOperation("**",a,value("-1"),hooks,realm).error!=="range")return 27;
 const minus=unaryObjectValueOperation("-",a,hooks,realm),minusValue=viewBigIntValue(minus.value);
 if(minus.error!=="none"||minusValue===undefined||bigIntToString(minusValue,10)!=="-18446744073709551615")return 28;
 return 42;
}`,
  "bigint-values",
  [["object", "packages/js-runtime/src/objects/index.ts"]],
  [],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewBigIntValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewObjectValue",
      operation: "view",
    },
    {
      module: "packages/js-runtime/src/objects/index.ts",
      name: "viewSymbolValue",
      operation: "view",
    },
  ],
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
);
