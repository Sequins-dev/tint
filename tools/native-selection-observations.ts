import { judgeExecution } from "./test262-execution.ts";
import {
  sameNativeObservationInput,
  type NativeObservation,
  type NativeObservationInput,
} from "./native-run-journal.ts";

/** A complete selection can be extracted from one run's append-only prefix.
 * Never combine snapshots or replace failures with later observations. */
export function nativeSelectionObservations(
  recorded: readonly NativeObservation[],
  expected: readonly NativeObservationInput[],
): NativeObservation[] {
  const key = (input: NativeObservationInput): string =>
    input.path + "\0" + input.variant;
  const inputs = new Map(expected.map((input) => [key(input), input]));
  if (inputs.size !== expected.length || inputs.size === 0)
    throw Error("selection must contain distinct expected variants");
  const found = new Map<string, NativeObservation>();
  for (const observation of recorded) {
    const id = key(observation),
      input = inputs.get(id);
    if (input === undefined) continue;
    if (found.has(id)) throw Error("duplicate selected observation");
    if (!sameNativeObservationInput(observation, input))
      throw Error("selected source or harness identity differs");
    if (
      judgeExecution(observation.metadata, observation.outcome) !==
      observation.status
    )
      throw Error("selected observation status differs");
    found.set(id, observation);
  }
  if (found.size !== inputs.size) throw Error("native selection is incomplete");
  return expected.map((input) => found.get(key(input))!);
}
