import type { BuildRequest } from "@tint/compiler/build";
import { tmpdir } from "node:os";
import { createNodeFileHost } from "./node-file-host.ts";

/** Shared by Node-hosted native suite builds and compiler bootstraps. */
export function functionStorageFromEnvironment(): BuildRequest["storage"] {
  const policy = process.env.TINT_STORAGE;
  if (policy === undefined || policy === "memory") return undefined;
  if (policy !== "all" && policy !== "budget")
    throw Error("TINT_STORAGE must be memory, budget or all");
  const budget = process.env.TINT_STORAGE_BYTE_BUDGET;
  if (policy === "budget" && (budget === undefined || budget.trim() === ""))
    throw Error("TINT_STORAGE=budget requires TINT_STORAGE_BYTE_BUDGET");
  return {
    policy,
    directory: process.env.TINT_STORAGE_DIRECTORY ?? tmpdir(),
    files: createNodeFileHost(),
    ...(budget === undefined ? {} : { byteBudget: Number(budget) }),
  };
}
