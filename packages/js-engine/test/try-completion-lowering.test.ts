import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoweredRealm } from "./lowered-node-host.ts";

// TryStatement evaluation (ECMA-262 14.15.3): a Finally block's own
// completion starts empty. A normal Finally restores the Block/Catch
// completion C; an abrupt Finally (break/continue) carries the Finally
// statement list's value, and UpdateEmpty(F, undefined) makes an empty
// abrupt Finally produce undefined, never C. Test262:
// language/statements/try/completion-values.js.
const cases: readonly (readonly [string, string])[] = [
  // Abrupt finally with a value replaces C.
  [
    "99; do { -99; try { 39 } catch (e) { -1 } finally { 42; break; -2 }; } while (false);",
    "42",
  ],
  [
    "99; do { -99; try { [].x.x } catch (e) { -1; } finally { 42; break; -3 }; } while (false);",
    "42",
  ],
  [
    "99; do { -99; try { 39 } catch (e) { -1 } finally { 42; break; -3 }; -77 } while (false);",
    "42",
  ],
  [
    "99; do { -99; try { 39 } catch (e) { -1 } finally { 42; continue; -3 }; } while (false);",
    "42",
  ],
  [
    "99; do { -99; try { [].x.x } catch (e) { -1 } finally { 42; continue; -3 }; -77 } while (false);",
    "42",
  ],
  // An empty abrupt finally produces undefined, not C.
  [
    "99; do { -99; try { 39 } catch (e) { -1 } finally { break; -2 }; } while (false);",
    "undefined",
  ],
  [
    "99; do { -99; try { [].x.x } catch (e) { -1; } finally { break; -3 }; } while (false);",
    "undefined",
  ],
  [
    "99; do { -99; try { 39 } catch (e) { -1 } finally { break; -3 }; -77 } while (false);",
    "undefined",
  ],
  [
    "99; do { -99; try { [].x.x } catch (e) { -1; } finally { break; -3 }; -77 } while (false);",
    "undefined",
  ],
  [
    "99; do { -99; try { 39 } finally { continue; } } while (false);",
    "undefined",
  ],
  ["99; l: { try { 39 } finally { break l; } }", "undefined"],
  // A normal finally keeps C, including C = undefined from an empty Block.
  ["99; try { 39 } finally { 42 }", "39"],
  ["99; try { [].x.x } catch (e) { -1 } finally { 42 }", "-1"],
  ["99; try { } finally { 42 }", "undefined"],
  ["99; try { [].x.x } catch (e) { } finally { 42 }", "undefined"],
  // Block break/continue values survive a normal finally.
  ["99; do { try { 39; break } finally { 42 } } while (false);", "39"],
  ["99; do { try { break } finally { 42 } } while (false);", "undefined"],
  // Nested finally completions are independent.
  [
    "99; do { try { 1 } finally { try { 2 } finally { 3 } break } } while (false);",
    "2",
  ],
  [
    "99; do { try { 1 } finally { 2; try { 3 } finally { break } } } while (false);",
    "undefined",
  ],
];

test("try/finally completion values follow UpdateEmpty for abrupt finally blocks", () => {
  const realm = createLoweredRealm();
  const failures: string[] = [];
  for (const [source, expected] of cases) {
    const outcome = realm.run(
      `var actual = eval(${JSON.stringify(source)}); ` +
        `print(typeof actual === "undefined" ? "undefined" : String(actual));`,
    );
    assert.equal(outcome, "none", source);
    const actual = realm.printed.pop();
    if (actual !== expected)
      failures.push(`${source} => ${actual}, expected ${expected}`);
  }
  assert.deepEqual(failures, []);
});
