// Comprehensive async / Promise microtask benchmark kernels.
// Each exported kernel takes `scale: number` and returns a Promise<number>
// resolving to a deterministic 32-bit signed integer checksum.

function mix32(acc: number, value: number): number {
  return (Math.imul(acc, 31) + (value | 0)) | 0;
}

// --- Promise.resolve + chained .then microtasks ---
export function promiseChains(scale: number): Promise<number> {
  let checksum = 0;
  let chain: Promise<number> = Promise.resolve(0);
  for (let round = 0; round < scale; round++) {
    const r = round;
    chain = chain
      .then((prev) => (prev + (r & 31)) | 0)
      .then((v) => (v ^ ((r * 3) & 63)) | 0)
      .then((v) => {
        checksum = mix32(checksum, v);
        return v;
      });
  }
  return chain.then(() => checksum);
}

// --- Promise.all / Promise.allSettled / Promise.race batches ---
export async function promiseAllBatch(scale: number): Promise<number> {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const batch: Promise<number>[] = [];
    for (let i = 0; i < 8; i++) {
      const val = (round + i * 7) & 255;
      batch.push(Promise.resolve(val).then((x) => (x * 3 + 1) | 0));
    }
    const results = await Promise.all(batch);
    let batchSum = 0;
    for (let i = 0; i < results.length; i++) {
      batchSum = (batchSum + (results[i] ?? 0)) | 0;
    }
    const raced = await Promise.race([
      Promise.resolve(round & 15),
      Promise.resolve((round + 1) & 15),
    ]);
    const settled = await Promise.allSettled([
      Promise.resolve(round & 7),
      Promise.reject(round & 3),
    ]);
    const okCount = settled.filter((s) => s.status === "fulfilled").length;
    checksum = mix32(checksum, batchSum + raced + okCount);
  }
  return checksum;
}

// --- async / await sequential chains & rejection try/catch ---
async function asyncStep(x: number, round: number): Promise<number> {
  const first = await Promise.resolve((x + (round & 15)) | 0);
  if ((round & 15) === 7) {
    throw (first & 31) + 1;
  }
  return await Promise.resolve((first * 3 + 1) | 0);
}

export async function asyncAwaitMicrotasks(scale: number): Promise<number> {
  let checksum = 0;
  let state = 1;
  for (let round = 0; round < scale; round++) {
    try {
      state = await asyncStep(state, round);
    } catch (caught) {
      state = (state + Number(caught)) | 0;
    }
    checksum = mix32(checksum, state);
  }
  return checksum;
}
