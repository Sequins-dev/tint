import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ReadableStream, WritableStream } from "node:stream/web";

const input = Readable.from([1, 2]);
const output = new Writable<number>({
  objectMode: true,
  write(value, _encoding, done) {
    value.toFixed();
    done();
  },
});
input.on("data", (value) => value.toFixed());
const running: Promise<void> = pipeline(input, output, {
  signal: new AbortController().signal,
});
const web = new ReadableStream<number>({
  pull(controller) {
    controller.enqueue(1);
  },
});
const copy: Promise<void> = web.pipeTo(
  new WritableStream<number>({
    write(value) {
      value.toFixed();
    },
  }),
);
void [running, copy];
// @ts-expect-error The destination must accept the source element type.
pipeline(input, new Writable<string>());
// @ts-expect-error Web writers consume the declared element type.
new WritableStream<number>().getWriter().write("wrong");
