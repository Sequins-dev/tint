import type { SegmentationGranularity } from "@tint/foundation/unicode/segmentation";

/** One internal slot carries the three Intl.Segmenter object kinds; brand
 * checks compare `kind`. Segments and Segment Iterator objects keep the
 * segmenter's resolved locale and granularity, as the specification's
 * [[SegmentsSegmenter]] / [[IteratingSegmenter]] slots would provide. */
export interface SegmenterState {
  readonly kind: "segmenter" | "segments" | "iterator";
  readonly locale: string;
  readonly granularity: SegmentationGranularity;
  /** [[SegmentsString]] / [[IteratedString]]; empty for a Segmenter. */
  readonly input: string;
  /** Boundaries computed on first use and shared with created iterators. */
  boundaries: number[] | undefined;
  /** [[IteratedStringNextSegmentCodeUnitIndex]] for iterators. */
  position: number;
}
