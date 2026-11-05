import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createByteStorage,byteStorageData,resizeByteStorage,transferByteStorage,detachByteStorage,copyByteStorage,copyImmutableByteStorage,byteStorageWindow} from "storage";
export function run():number {
 const created=createByteStorage(2,8,true,16);
 if(!created.ok)return 1;
 const storage=created.value,initial=byteStorageData(storage);
 if(initial===undefined||initial.length!==2||initial[0]!==0)return 2;
 initial[0]=19;initial[1]=23;
 if(resizeByteStorage(storage,4)!=="none")return 3;
 const grown=byteStorageData(storage);
 if(grown===undefined||grown[0]!==19||grown[1]!==23||grown[2]!==0)return 4;
 if(resizeByteStorage(storage,1)!=="none"||resizeByteStorage(storage,4)!=="none")return 5;
 const regrown=byteStorageData(storage);
 if(regrown===undefined||regrown[0]!==19||regrown[1]!==0)return 6;
 const window=byteStorageWindow(storage,0,undefined,2);
 if(window===undefined||window.length!==2)return 15;
 if(resizeByteStorage(storage,3)!=="none")return 16;
 const shortened=byteStorageWindow(storage,0,undefined,2);
 if(shortened===undefined||shortened.length!==1||byteStorageWindow(storage,0,2,2)!==undefined)return 17;
 if(resizeByteStorage(storage,4)!=="none"||byteStorageWindow(storage,0,2,2)===undefined)return 18;
 const refreshed=byteStorageData(storage);
 if(refreshed===undefined)return 19;
 const rejected=transferByteStorage(storage,9,"preserve-resizability");
 if(rejected.ok||rejected.error!=="invalid-length"||byteStorageData(storage)!==refreshed)return 7;
 const moved=transferByteStorage(storage,6,"preserve-resizability");
 if(!moved.ok||byteStorageData(storage)!==undefined||!moved.value.resizable||moved.value.maxByteLength!==8)return 8;
 const bytes=byteStorageData(moved.value);
 if(bytes===undefined||bytes.length!==6||bytes[0]!==19||bytes[5]!==0)return 9;
 const fixed=transferByteStorage(moved.value,10,"fixed-length");
 if(!fixed.ok||fixed.value.resizable||fixed.value.maxByteLength!==10||byteStorageData(moved.value)!==undefined)return 10;
 if(resizeByteStorage(fixed.value,10)!=="fixed-length")return 11;
 if(copyByteStorage(fixed.value,fixed.value,0,1,2)!=="none")return 13;
 const copied=byteStorageData(fixed.value);
 if(copied===undefined||copied[0]!==19||copied[1]!==19||copied[2]!==0)return 14;
 const immutable=copyImmutableByteStorage(fixed.value,0,2,3);
 if(!immutable.ok||!immutable.value.immutable||immutable.value.resizable||immutable.value.maxByteLength!==3)return 20;
 const read=byteStorageData(immutable.value);
 if(read===undefined||read[0]!==19||read[1]!==19||read[2]!==0)return 21;
 if(byteStorageData(immutable.value,"write")!==undefined||byteStorageWindow(immutable.value,0,undefined,1,"write")!==undefined)return 22;
 if(detachByteStorage(immutable.value)!=="immutable"||resizeByteStorage(immutable.value,0)!=="immutable")return 23;
 if(copyByteStorage(fixed.value,immutable.value,0,0,0)!=="immutable")return 24;
 const blocked=transferByteStorage(immutable.value,0,"fixed-length");
 if(blocked.ok||blocked.error!=="immutable")return 25;
 const frozen=transferByteStorage(fixed.value,12,"immutable");
 if(!frozen.ok||!frozen.value.immutable||frozen.value.resizable||byteStorageData(fixed.value)!==undefined)return 26;
 const frozenBytes=byteStorageData(frozen.value);
 if(frozenBytes===undefined||frozenBytes.length!==12||frozenBytes[0]!==19||frozenBytes[11]!==0)return 27;
 const empty=copyImmutableByteStorage(frozen.value,99,0,0);
 if(!empty.ok||!empty.value.immutable)return 28;
 detachByteStorage(fixed.value);detachByteStorage(fixed.value);
 if(resizeByteStorage(fixed.value,0)!=="detached")return 12;
 return 42;
}`,
  "byte-storage",
  [["storage", "packages/js-runtime/src/bytes/index.ts"]],
);
