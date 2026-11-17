/** Linux errno names (asm-generic/errno-base.h and errno.h, which arm64
 * uses). Numbers 1-34 match Darwin; later ones differ. */
export function linuxErrorCode(errno: number): string {
  switch (errno) {
    case 1:
      return "EPERM";
    case 2:
      return "ENOENT";
    case 4:
      return "EINTR";
    case 5:
      return "EIO";
    case 9:
      return "EBADF";
    case 12:
      return "ENOMEM";
    case 13:
      return "EACCES";
    case 17:
      return "EEXIST";
    case 20:
      return "ENOTDIR";
    case 21:
      return "EISDIR";
    case 22:
      return "EINVAL";
    case 23:
      return "ENFILE";
    case 24:
      return "EMFILE";
    case 28:
      return "ENOSPC";
    case 30:
      return "EROFS";
    case 36:
      return "ENAMETOOLONG";
    case 39:
      return "ENOTEMPTY";
    case 40:
      return "ELOOP";
    default:
      return "ERRNO_" + String(errno);
  }
}
