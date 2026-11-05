interface JobEntry<Context> {
  readonly job: () => void;
  readonly context: Context;
  next: JobEntry<Context> | undefined;
}
/** One FIFO checkpoint queue. Hosts own when to drain and how to enter context. */
export interface JobQueue<Context> {
  head: JobEntry<Context> | undefined;
  tail: JobEntry<Context> | undefined;
  size: number;
  draining: boolean;
}
export function createJobQueue<Context>(): JobQueue<Context> {
  return { head: undefined, tail: undefined, size: 0, draining: false };
}
export function enqueueJob<Context>(
  queue: JobQueue<Context>,
  job: () => void,
  context: Context,
): void {
  const entry: JobEntry<Context> = { job, context, next: undefined };
  const tail = queue.tail;
  if (tail === undefined) queue.head = entry;
  else tail.next = entry;
  queue.tail = entry;
  queue.size++;
}
/** Drain to quiescence, including jobs appended by running jobs. Nested drains
 * are deferred to the current checkpoint. Executor errors propagate, consuming
 * that entry while preserving the remaining queue for a later checkpoint. */
export function drainJobs<Context>(
  queue: JobQueue<Context>,
  run: (job: () => void, context: Context) => void,
): number {
  if (queue.draining) return 0;
  queue.draining = true;
  let count = 0;
  try {
    for (;;) {
      const entry = queue.head;
      if (entry === undefined) break;
      queue.head = entry.next;
      if (queue.head === undefined) queue.tail = undefined;
      entry.next = undefined;
      queue.size--;
      run(entry.job, entry.context);
      count++;
    }
  } finally {
    queue.draining = false;
  }
  return count;
}
