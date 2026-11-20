import test from "node:test";

/** Keep the standalone timeout, but start the gate's test deadline after
 * admission. The native batch watchdog still covers fixture preparation. */
export function testNativeLaunch(
  name: string,
  options: { skip?: boolean | string; timeout: number },
  run: (onAdmitted: () => void) => Promise<void>,
) {
  if (!process.env.TINT_GATE_NATIVE_IMAGES)
    return test(name, options, () => run(() => {}));

  const deadline = new AbortController();
  return test(
    name,
    { skip: options.skip ?? false, signal: deadline.signal },
    async (t) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      t.after(() => clearTimeout(timer));
      await run(() => {
        timer = setTimeout(() => {
          deadline.abort(
            Error(`Native launch test timed out after ${options.timeout}ms`),
          );
        }, options.timeout);
      });
    },
  );
}
