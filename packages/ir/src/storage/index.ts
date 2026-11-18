export {
  createFunctionStore,
  createMemorySpillBackend,
  type FunctionStore,
  type FunctionStoreOptions,
  type FunctionStoreStatistics,
  type SpillBackend,
  type SpillPolicy,
} from "./store.ts";
export {
  createPackedVocabulary,
  decodeFunction,
  encodeFunction,
  packedFunctionVersion,
  type PackedVocabulary,
} from "./codec.ts";
export { createByteWriter, writtenBytes, type ByteWriter } from "./bytes.ts";
