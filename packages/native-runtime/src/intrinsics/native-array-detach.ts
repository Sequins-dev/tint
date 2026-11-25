/** Trusted detachment of a native typed-array view (host operation
 * native-array-detach): its length becomes 0 and its data pointer leaves its
 * owner's payload, so element reads give undefined, writes are ignored and
 * operations that validate the buffer throw. An owned or borrowed array, and
 * any value that is not a native typed array, is left unchanged. The program
 * realm's projected views (projectNativeTypedArray) are its only users. */
export function detachNativeArray(view: unknown): void {
  throw "HOST_UNAVAILABLE";
}
