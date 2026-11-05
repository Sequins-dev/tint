/** Scalar-only engine-lifetime shared registry ABI. All cells are aligned uint64;
 * no control/payload mapping contains a managed pointer. Handles are positive,
 * never-reused descriptor indices. The mapping-derived engine identity is private
 * runtime metadata, never a Script address capability. Publication and quotas are
 * authoritative here, independently of moving service/wrapper objects. */
export const sharedRegistryMagic = 0x54425331;
export const sharedRegistryHeaderBytes = 64;
export const sharedRegistryMagicOffset = 0;
export const sharedRegistryEngineOffset = 8;
export const sharedRegistryBlockLimitOffset = 16;
export const sharedRegistryReservationLimitOffset = 24;
export const sharedRegistryPageSizeOffset = 32;
export const sharedRegistryPublishedCountOffset = 40;
export const sharedRegistryReservedBytesOffset = 48;
export const sharedRegistryLockOffset = 56;
export const sharedBlockDescriptorBytes = 48;
export const sharedBlockStateOffset = 0;
export const sharedBlockAddressOffset = 8;
export const sharedBlockReservationOffset = 16;
export const sharedBlockMaximumOffset = 24;
export const sharedBlockLengthOffset = 32;
export const sharedBlockGrowableOffset = 40;
export const sharedBlockPublished = 1;
