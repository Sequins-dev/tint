import test from "node:test";
import { verifyLargeImage } from "./verify-large-image.ts";

test(
  "a signed multi-chunk image unwinds across far code and survives a copying collection",
  {
    skip: process.platform !== "darwin" || process.arch !== "arm64",
  },
  () => verifyLargeImage(false),
);
