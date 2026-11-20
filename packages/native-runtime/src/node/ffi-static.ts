/** Hosts may supply fixed scalar call stubs and select the weak-slot policy. */
export function ffiWeakProcessing(): boolean {
  return true;
}

export function staticFfiIndex(key: string): number {
  return -1;
}

export function staticFfiCall(index: number, frame: Uint8Array): boolean {
  return false;
}
