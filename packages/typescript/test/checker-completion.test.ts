import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalCompletion,
  returnCompletion,
  breakCompletion,
  continueCompletion,
  throwCompletion,
  sequenceCompletion,
  catchCompletion,
  finallyCompletion,
  loopCompletion,
} from "@tint/typescript/checker";
const kinds = [
  normalCompletion,
  returnCompletion,
  breakCompletion,
  continueCompletion,
  throwCompletion,
];
function members(mask: number): number[] {
  return kinds.filter((kind) => (mask & kind) !== 0);
}
function mask(values: readonly number[]): number {
  return values.reduce((result, value) => result | value, 0);
}
test("completion algebra matches path-by-path execution for all completion sets", () => {
  for (let left = 0; left < 32; left++) {
    const paths = members(left);
    for (let right = 0; right < 32; right++) {
      const next = members(right);
      assert.equal(
        sequenceCompletion(left, right),
        mask(
          paths.flatMap((path) => (path === normalCompletion ? next : [path])),
        ),
      );
      assert.equal(
        catchCompletion(left, right, false),
        mask(
          paths.flatMap((path) => (path === throwCompletion ? next : [path])),
        ),
      );
      assert.equal(
        catchCompletion(left, right, true),
        mask([...paths.filter((path) => path !== throwCompletion), ...next]),
      );
      assert.equal(
        finallyCompletion(left, right),
        mask(
          paths.flatMap((path) =>
            next.map((cleanup) =>
              cleanup === normalCompletion ? path : cleanup,
            ),
          ),
        ),
      );
    }
    const loopPaths = paths.map((path) =>
      path === breakCompletion || path === continueCompletion
        ? normalCompletion
        : path,
    );
    assert.equal(loopCompletion(left, true), mask(loopPaths));
    assert.equal(
      loopCompletion(left, false),
      mask([normalCompletion, ...loopPaths]),
    );
  }
});

test("unconditional loop completion only exits normally through break", () => {
  for (let body = 0; body < 32; body++) {
    const expected = members(body).flatMap((path) =>
      path === breakCompletion
        ? [normalCompletion]
        : path === normalCompletion || path === continueCompletion
          ? []
          : [path],
    );
    assert.equal(loopCompletion(body, false, true), mask(expected));
    assert.equal(loopCompletion(body, true, true), mask(expected));
  }
});
