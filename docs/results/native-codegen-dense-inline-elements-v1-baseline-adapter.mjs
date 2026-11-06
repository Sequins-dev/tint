import { registerHooks } from "node:module";
registerHooks({
  load(url, context, next) {
    const r = next(url, context);
    if (!url.endsWith("/packages/ir/dist/optimization/reference-lists.js"))
      return r;
    let source = String(r.source);
    const pattern = "export function lowerReferenceLists(";
    if (!source.includes(pattern)) throw Error("private dense entry missing");
    source =
      source.replace(pattern, "function pOriginalLowerReferenceLists(") +
      "\nexport function lowerReferenceLists(){ return undefined; }\n";
    return { ...r, source };
  },
});
