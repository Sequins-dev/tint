// A typed Worker entry that completes abruptly after one message.
import { parentPort } from "node:worker_threads";

const port = parentPort;
if (port === null) throw new TypeError("the thrower must run in a Worker");
port.postMessage("before");
throw new TypeError("thrown by the typed Worker");
