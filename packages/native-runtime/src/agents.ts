/** Agent-local facades over raw copied-message and lifecycle state. */
export {
  createNativeAgentMailbox,
  attachNativeAgentMailbox,
  type NativeAgentMailbox,
} from "./agent-messages.ts";
export {
  createNativeAgentCluster,
  attachNativeAgentWorker,
  type NativeAgentCluster,
  type NativeAgentWorker,
  type NativeAgentThreads,
  type NativeAgentBroadcast,
} from "./agent-lifecycle.ts";
