/** Build-time specialization supplies entries for recognized literal
 * signatures. An ordinary call plan remains available for every signature. */
export function staticFfiIndex(key: string): number {
  return -1;
}

export function staticFfiCall(index: number, frame: Uint8Array): boolean {
  return false;
}
