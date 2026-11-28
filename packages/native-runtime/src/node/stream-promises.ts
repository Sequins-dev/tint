import {
  Readable,
  Writable,
  finished as observe,
  pump,
  type FinishedOptions,
  type PipelineOptions,
} from "./stream.ts";

export function finished(
  stream: Readable | Writable,
  options: FinishedOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    observe(stream, options, (error): void => {
      if (error !== undefined && error !== null) reject(error);
      else resolve();
    });
  });
}
export function pipeline(
  source: Readable | Iterable<unknown> | AsyncIterable<unknown>,
  destination: Writable,
  options?: PipelineOptions,
): Promise<void> {
  return pump(
    source instanceof Readable ? source : Readable.from(source),
    destination,
    options,
  );
}
export default { finished, pipeline };
