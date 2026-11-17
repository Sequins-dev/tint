/** Darwin mmap(2) flag values for external storage (sys/mman.h). Linux
 * shares every value except MAP_ANON (0x20). */
export const protectionNone = 0;
export const protectionReadWrite = 3;
export const mapPrivate = 0x2;
export const mapFixed = 0x10;
export const mapAnonymous = 0x1000;
/** Mapping granularity (the arm64 page size). */
export const pageBytes = 16384;
