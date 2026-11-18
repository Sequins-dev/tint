/** Transition records (docs/gc-stack-maps.md, "Transition records"): how
 * the stack walk crosses C frames between a callback and the may-callback
 * call that let C call back (docs/native-ffi.md, "Callbacks").
 *
 * C frames need not keep frame pointers and may save x19..x28 anywhere, so
 * the walk never reads them. A callback thunk (a registry range whose table
 * word is `transitionTable`) stores the address of the innermost
 * transition record at a fixed word of its frame; the record begins with
 * the may-callback caller's frame pointer and the call's return address,
 * so it is itself a frame record the walk resumes at. The call is a
 * safepoint whose map lists every reference live across it (the callback
 * function values among them) and its caller keeps none in registers, so
 * nothing below the record needs the C frames' saves.
 *
 * Plain reads only: the walk must not allocate. */
/** Reads an unsigned word, or undefined (as scan.ts's ReadWord). */
type ReadWord = (address: number) => number | undefined;
/** A registry entry's table word for callback thunks (abi host.ts
 * nativeStackMapTransitionTable; repeated for frozen runtime builds). */
export const transitionTable = 1;
/** The thunk frame's word holding its transition record (abi host.ts
 * nativeCallbackThunkTransitionOffset). */
const thunkTransitionOffset = 48;
/** The frame record to resume at past the C frames above callback thunk
 * frame `thunkFrame` (its frame pointer): the transition record's address,
 * -1 when unreadable, or -2 when malformed (not an aligned address above
 * the thunk frame, toward the stack base). */
export function transitionFrame(read: ReadWord, thunkFrame: number): number {
  const record = read(thunkFrame + thunkTransitionOffset);
  if (record === undefined) return -1;
  if (
    !Number.isSafeInteger(record) ||
    record <= thunkFrame ||
    record % 16 !== 0
  )
    return -2;
  return record;
}
