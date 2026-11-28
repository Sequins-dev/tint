import { schedulingFunction } from "./scheduling.ts";

const timeout = setTimeout;
const interval = setInterval;
const cancelTimeout = clearTimeout;
const cancelInterval = clearInterval;
export {
  timeout as setTimeout,
  interval as setInterval,
  cancelTimeout as clearTimeout,
  cancelInterval as clearInterval,
};
export const setImmediate = schedulingFunction("setImmediate");
export const clearImmediate = schedulingFunction("clearImmediate");

export default {
  setTimeout: timeout,
  setInterval: interval,
  clearTimeout: cancelTimeout,
  clearInterval: cancelInterval,
  setImmediate,
  clearImmediate,
};
