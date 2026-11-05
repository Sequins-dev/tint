/** Caller-authorized host entropy leaf; result is an unsigned 32-bit integer. */
export function randomUint32(): number {
  throw "HOST_UNAVAILABLE";
}
/** Uniform 53-bit grid in [0,1), with independent host draws on every call. */
export function randomNumber(): number {
  const high = randomUint32(),
    low = randomUint32();
  return (high * 2097152 + Math.floor(low / 2048)) / 9007199254740992;
}
