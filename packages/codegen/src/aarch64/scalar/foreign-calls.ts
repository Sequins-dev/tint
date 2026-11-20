import {
  classifyCCall,
  cLayout,
  type CCallLayout,
  type CScalar,
  type CTarget,
  type CType,
} from "@tint/abi/c";
import {
  transitionBytes,
  dynamicCallFrame,
  type ForeignCall,
} from "@tint/ir/scalar";
/** Outgoing frame use of one c-call: the classified layout, the frame
 * offset of each indirect argument's caller-owned copy (-1 otherwise), the
 * byte size checked for each record or record-pointee operand (0: none)
 * and the bytes the call needs at the bottom of the frame. */
export interface ForeignCallPlan {
  readonly layout: CCallLayout;
  readonly copies: readonly number[];
  readonly minimums: readonly number[];
  /** A record result's size (its trailing buffer operand's minimum). */
  readonly resultBytes: number;
  readonly frameBytes: number;
  /** A may-callback call's transition record offset in the outgoing area
   * (after the stack arguments and copies), else -1. */
  readonly transition: number;
}
export type ForeignCallPlanResult =
  | { readonly ok: true; readonly value: ForeignCallPlan }
  | { readonly ok: false; readonly error: string };
function sizeOf(type: CType, target: CTarget): number {
  const layout = cLayout(type, target);
  return layout.ok ? layout.value.size : 0;
}
export function planForeignCall(
  call: ForeignCall,
  target: CTarget,
): ForeignCallPlanResult {
  const classified = classifyCCall(call.signature, target);
  if (!classified.ok) return classified;
  const layout = classified.value;
  // The universal trampoline copies up to its frame's stack capacity into
  // the outgoing argument area; its own operands are never copied.
  if (call.dynamic === true) {
    const transition =
      call.dynamicScalar === true ? 0 : dynamicCallFrame.stackCapacity;
    const scoped =
      call.dynamicScalar === true ? 0 : dynamicCallFrame.callbackOperands;
    return {
      ok: true,
      value: {
        layout,
        copies: layout.arguments.map(() => -1),
        minimums: layout.arguments.map(() => 0),
        resultBytes: 0,
        // A may-callback trampoline's transition follows the stack area.
        frameBytes:
          transition +
          (call.mayCallback === true ? transitionBytes(scoped) : 0),
        transition: call.mayCallback === true ? transition : -1,
      },
    };
  }
  const copies: number[] = [],
    minimums: number[] = [];
  let frame = layout.stackBytes;
  for (let index = 0; index < layout.arguments.length; index++) {
    const location = layout.arguments[index],
      type = call.signature.parameters[index];
    if (location === undefined || type === undefined)
      throw "foreign plan argument invariant";
    if (location.class === "indirect") {
      copies.push(frame);
      frame += Math.ceil(location.size / 16) * 16;
    } else copies.push(-1);
    minimums.push(
      type.kind === "record"
        ? sizeOf(type, target)
        : type.kind === "pointer" && type.pointee.kind === "record"
          ? sizeOf(type.pointee, target)
          : 0,
    );
  }
  const resultBytes =
    call.signature.result.kind === "record"
      ? sizeOf(call.signature.result, target)
      : 0;
  let transition = -1;
  if (call.mayCallback === true) {
    // The record holds one word per callback, then direct callbacks'
    // views.
    const prototypes = call.callbacks ?? [],
      directs = call.directCallbacks ?? [];
    let callbacks = 0,
      views = 0;
    for (let index = 0; index < prototypes.length; index++)
      if (prototypes[index] !== undefined) callbacks++;
    for (let index = 0; index < directs.length; index++)
      views += directs[index]?.length ?? 0;
    transition = Math.ceil(frame / 16) * 16;
    frame = transition + transitionBytes(callbacks, views);
  }
  return {
    ok: true,
    value: {
      layout,
      copies,
      minimums,
      resultBytes,
      frameBytes: frame,
      transition,
    },
  };
}
/** The C scalar a `number` operand or result converts as: raw pointers
 * (`Address<T>`) are 64-bit unsigned addresses, converted exactly. */
export function numericScalar(type: CType): CScalar {
  if (type.kind === "scalar") return type.scalar;
  if (type.kind === "pointer") return "usize";
  throw "c-call numeric type invariant";
}
