import ts from "/Users/stephenbelanger/.t3/worktrees/tint/t3-c0227322-base/node_modules/typescript/lib/typescript.js";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
const root = process.argv[2];
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true, verbatimModuleSyntax: true, declaration: false };
let same = 0, diff = 0, missing = 0;
function walk(dir, out) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith(".ts") && !n.endsWith(".d.ts")) out.push(p); } }
for (const pkg of readdirSync(join(root, "packages"))) {
  const src = join(root, "packages", pkg, "src"); if (!existsSync(src)) continue;
  const files = []; walk(src, files);
  for (const f of files) {
    const js = join(root, "packages", pkg, "dist", relative(src, f).replace(/\.ts$/, ".js"));
    if (!existsSync(js)) { missing++; console.log("MISSING", js); continue; }
    const out = ts.transpileModule(readFileSync(f, "utf8"), { compilerOptions: options, fileName: f }).outputText;
    const norm = (s) => s.replace(/\/\/# sourceMappingURL=.*\n?/g, "").trim();
    if (norm(out) === norm(readFileSync(js, "utf8"))) same++; else { diff++; if (diff <= 5) console.log("DIFF", relative(root, f)); }
  }
}
console.log(root.split("/").pop(), "same", same, "diff", diff, "missing", missing);
