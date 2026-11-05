/** Trusted managed weak storage. Only explicit compiler capabilities replace
 * these declarations; their names alone grant nothing. Opaque handles use unknown
 * because the physical marker-7 cell is not an ordinary TypeScript record.
 * Copying collection is required until generational weak barriers are supported. */
export function createWeakSlot(
  key: unknown,
  value: unknown,
  ephemeron: boolean,
): unknown {
  throw "HOST_UNAVAILABLE";
}
export function weakSlotKey(cell: unknown): unknown {
  throw "HOST_UNAVAILABLE";
}
export function weakSlotValue(cell: unknown): unknown {
  throw "HOST_UNAVAILABLE";
}
/** Trusted precondition: cell is an ephemeron created by this service. */
export function setWeakSlotValue(cell: unknown, value: unknown): void {
  throw "HOST_UNAVAILABLE";
}
export function clearWeakSlot(cell: unknown): void {
  throw "HOST_UNAVAILABLE";
}
