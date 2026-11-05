import {
  createExternalMemoryRegistry,
  type ExternalMemoryRegistry,
} from "./tracing/index.ts";
import { configureExternalMemory } from "./intrinsics/memory.ts";

/** Called on the permanent control allocator before managed allocation starts.
 * Collector reads and the application registrar share this one policy object. */
export function initializeExternalMemory(
  managedBase: number,
  managedLength: number,
  controlBase: number,
  controlLength: number,
  imageBase: number,
  imageLength: number,
  stackBase: number,
  stackLength: number,
): ExternalMemoryRegistry {
  const storage = new Float64Array(129),
    reserved = new Float64Array(8);
  reserved[0] = managedBase;
  reserved[1] = managedLength;
  reserved[2] = controlBase;
  reserved[3] = controlLength;
  reserved[4] = imageBase;
  reserved[5] = imageLength;
  reserved[6] = stackBase;
  reserved[7] = stackLength;
  const registry = createExternalMemoryRegistry(storage, reserved);
  if (registry === undefined) throw "INVALID_EXTERNAL_MEMORY_WINDOWS";
  if (configureExternalMemory(registry.register) !== 0)
    throw "INVALID_EXTERNAL_MEMORY_PUBLICATION";
  return registry;
}
