/** Managed weak-cell wire format. General values use the same tag/payload pair
 * as roots and record fields. Physical layout is independent of JS API brands. */
export const nativeWeakSlotMarker = 7;
export const nativeWeakSlotByteLength = 48;
export const nativeWeakSlotFlagsOffset = 8;
export const nativeWeakSlotWeak = 0;
export const nativeWeakSlotEphemeron = 1;
export const nativeWeakSlotKeyOffset = 16;
export const nativeWeakSlotKeyPayloadOffset = 24;
export const nativeWeakSlotValueOffset = 32;
export const nativeWeakSlotValuePayloadOffset = 40;
