import { recordAllocationAlignment } from "@tint/ir/scalar";
import type { TargetDataLayout } from "@tint/ts-native/closure/layout";

/** Data layout of the aarch64 managed heap. Objects start and end on the
 * collectors' 8-byte allocation granule; frames keep the 16-byte stack
 * alignment. No managed field needs more than 8-byte alignment. */
export const nativeTargetLayout: TargetDataLayout = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: recordAllocationAlignment,
  frameAlignment: 16,
  maxAlignment: 8,
};
