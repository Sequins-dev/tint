export {
  scanNativeObject,
  scanNativeObjectWithVerifiedDescriptor,
  scanNativeRootsWithVerifiedDescriptors,
  scanNativeRoots,
  type ReadWord,
  type VisitReference,
  type ScanStatus,
} from "./scan.ts";
export { createNativeCollector, type NativeCollector } from "./collector.ts";
export {
  relocateNativeArrayData,
  type ForwardReference,
} from "./relocation.ts";
export { createNativeFixupPlanner, type NativeFixupPlanner } from "./fixups.ts";
export { nativeObjectExtent } from "./extent.ts";
export {
  createNurseryEvacuator,
  type NurseryOptions,
  type NurseryEvacuator,
} from "./nursery.ts";

export {
  createExternalMemoryRegistry,
  type ExternalMemoryRegistry,
} from "./external-memory.ts";
