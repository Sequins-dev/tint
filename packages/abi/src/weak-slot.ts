/** Managed weak-cell wire format. General values use the same tag/payload pair
 * as roots and record fields. Physical layout is independent of JS API brands.
 * The weak/ephemeron kind is the header's flags field (see host.ts). */
export const nativeWeakSlotMarker = 7;
export const nativeWeakSlotByteLength = 40;
export const nativeWeakSlotWeak = 0;
export const nativeWeakSlotEphemeron = 1;
export const nativeWeakSlotKeyOffset = 8;
export const nativeWeakSlotKeyPayloadOffset = 16;
export const nativeWeakSlotValueOffset = 24;
export const nativeWeakSlotValuePayloadOffset = 32;
