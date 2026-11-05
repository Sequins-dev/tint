export interface TextScanner {
  readonly offset: () => number;
  readonly done: () => boolean;
  readonly peekCode: (ahead?: number) => number;
  readonly advance: (count?: number) => boolean;
  readonly match: (text: string) => boolean;
  readonly mark: () => number;
  readonly restore: (mark: number) => boolean;
  readonly eatWhile: (predicate: (code: number) => boolean) => string;
}
// Adapted from Fino's mark/restore/match/eatWhile cursor design; see NOTICE.md.
export function createScanner(text: string): TextScanner {
  let offset = 0;
  function valid(n: number, max: number): boolean {
    return Number.isInteger(n) && n >= 0 && n <= max;
  }
  function advance(count: number = 1): boolean {
    if (!valid(count, text.length - offset)) return false;
    offset += count;
    return true;
  }
  return {
    offset: () => offset,
    done: () => offset === text.length,
    peekCode: (ahead = 0) =>
      valid(ahead, text.length - offset - 1)
        ? text.charCodeAt(offset + ahead)
        : -1,
    advance,
    match: (value) => {
      if (value.length === 0 || !text.startsWith(value, offset)) return false;
      offset += value.length;
      return true;
    },
    mark: () => offset,
    restore: (mark) => {
      if (!valid(mark, text.length)) return false;
      offset = mark;
      return true;
    },
    eatWhile: (predicate) => {
      const start = offset;
      while (offset < text.length && predicate(text.charCodeAt(offset)))
        offset++;
      return text.slice(start, offset);
    },
  };
}
