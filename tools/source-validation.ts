import { fileURLToPath } from "node:url";
import ts from "typescript";
import { validateJavaScriptBindings } from "@tint/typescript/binding";
import { createSourceTextView } from "@tint/source/text";
import {
  eraseTypeSyntax,
  parseModule,
  parseScript,
} from "@tint/typescript/syntax";
import type { SourceDiagnostic } from "@tint/compiler/native";

export interface HostedValidationSource {
  readonly id: string;
  readonly text: string;
  readonly dependencies?: ReadonlyMap<string, string>;
  readonly goal?: "script" | "module";
  readonly unchecked?: boolean;
  readonly declaration?: boolean;
}

const projectDirectory = fileURLToPath(new URL("../", import.meta.url));

function projectOptions(): ts.CompilerOptions {
  const config = ts.readConfigFile(
    projectDirectory + "tsconfig.base.json",
    ts.sys.readFile,
  );
  if (config.error !== undefined)
    throw Error("cannot load Tint's TypeScript profile");
  const converted = ts.convertCompilerOptionsFromJson(
    config.config.compilerOptions,
    projectDirectory,
  );
  if (converted.errors.length !== 0)
    throw Error("invalid Tint TypeScript profile");
  return {
    ...converted.options,
    noEmit: true,
    // Tint resolves the captured specifiers directly and never rewrites them
    // to JavaScript filenames.
    rewriteRelativeImportExtensions: false,
    allowImportingTsExtensions: true,
  };
}

/** The composition root supplies the captured text and import edges. A verdict
 * holds diagnostics only, so subsequent builds need neither oracle syntax nor
 * access to mutable source files. */
export function createHostedSourceValidator(
  inputs: readonly HostedValidationSource[],
  options: ts.CompilerOptions = {},
): (entry: string) => readonly SourceDiagnostic[] {
  if (ts.version !== "6.0.3")
    throw Error("expected TypeScript 6.0.3, got " + ts.version);
  const compilerOptions = { ...projectOptions(), ...options };
  const byId = new Map<string, string>();
  const byFile = new Map<string, HostedValidationSource>();
  for (const input of inputs) {
    if (byId.has(input.id))
      throw Error("duplicate validation input: " + input.id);
    const extension = input.declaration === true ? ".d.ts" : ".ts";
    const file = "/__tint_validation__/" + byId.size + extension;
    byId.set(input.id, file);
    byFile.set(file, {
      ...input,
      ...(input.dependencies === undefined
        ? {}
        : { dependencies: new Map(input.dependencies) }),
    });
  }
  const verdicts = new Map<string, readonly SourceDiagnostic[]>();
  return (entry) => {
    const cached = verdicts.get(entry);
    if (cached !== undefined) return cached;
    const file = byId.get(entry);
    if (file === undefined) throw Error("missing validation entry: " + entry);
    const diagnostics = validate(file, byId, byFile, compilerOptions);
    verdicts.set(entry, diagnostics);
    return diagnostics;
  };
}

function validate(
  entry: string,
  byId: ReadonlyMap<string, string>,
  byFile: ReadonlyMap<string, HostedValidationSource>,
  options: ts.CompilerOptions,
): SourceDiagnostic[] {
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  const defaultLib = host.getDefaultLibLocation?.();
  host.getSourceFile = (file, language, onError, create) => {
    const input = byFile.get(file);
    if (input === undefined)
      return defaultLib !== undefined && file.startsWith(defaultLib + "/")
        ? readSource(file, language, onError, create)
        : undefined;
    const sourceOptions =
      typeof language === "number" ? { languageVersion: language } : language;
    return ts.createSourceFile(
      file,
      input.text,
      {
        ...sourceOptions,
        impliedNodeFormat:
          input.goal === "script"
            ? ts.ModuleKind.CommonJS
            : ts.ModuleKind.ESNext,
      },
      true,
    );
  };
  host.resolveModuleNameLiterals = (literals, containingFile) => {
    const input = byFile.get(containingFile);
    return literals.map(({ text }) => {
      const target = input?.dependencies?.get(text);
      const name = target === undefined ? undefined : byId.get(target);
      return {
        resolvedModule:
          name === undefined
            ? undefined
            : {
                resolvedFileName: name,
                extension: name.endsWith(".d.ts")
                  ? ts.Extension.Dts
                  : ts.Extension.Ts,
                isExternalLibraryImport: false,
              },
      };
    });
  };
  const program = ts.createProgram([entry], options, host);
  const checker = program.getTypeChecker();
  const diagnostics: SourceDiagnostic[] = [];
  function report(diagnostic: ts.Diagnostic): void {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) return;
    const start = diagnostic.start ?? 0;
    diagnostics.push({
      code: "TS" + diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      module:
        (diagnostic.file && byFile.get(diagnostic.file.fileName)?.id) ??
        byFile.get(entry)!.id,
      start,
      end: start + (diagnostic.length ?? 0),
    });
  }
  for (const error of program.getOptionsDiagnostics()) report(error);
  for (const error of program.getGlobalDiagnostics()) report(error);
  for (const file of program.getSourceFiles()) {
    const input = byFile.get(file.fileName);
    if (input === undefined) continue;
    for (const error of program.getSyntacticDiagnostics(file)) report(error);
    if (input.declaration !== true) {
      const goal = input.goal ?? "module";
      const source = createSourceTextView(input.text);
      const parsed =
        goal === "script" ? parseScript(source) : parseModule(source);
      if (parsed.ok) {
        const error = validateJavaScriptBindings(
          eraseTypeSyntax(parsed.value),
          goal,
        );
        if (
          error !== undefined &&
          error.code !== "UNSUPPORTED" &&
          error.code !== "LIMIT"
        )
          diagnostics.push({
            code: error.code,
            message: error.message,
            module: input.id,
            start: error.start,
            end: error.end,
          });
      }
    }
    if (input.unchecked !== true)
      for (const error of program.getSemanticDiagnostics(file))
        if (!isOpenSlotWrite(error, file, checker)) report(error);
  }
  return diagnostics;
}

function isOpenSlotWrite(
  diagnostic: ts.Diagnostic,
  file: ts.SourceFile,
  checker: ts.TypeChecker,
): boolean {
  if (diagnostic.code !== 2322 || diagnostic.start === undefined) return false;
  const start = diagnostic.start;
  const end = start + (diagnostic.length ?? 0);
  function visit(node: ts.Node): boolean {
    if (node.getStart(file) > start || node.end < end) return false;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target = node.left;
      if (
        ts.isIdentifier(target) &&
        target.getStart(file) === start &&
        target.end === end
      ) {
        const declaration =
          checker.getSymbolAtLocation(target)?.valueDeclaration;
        if (declaration === undefined) return false;
        if (ts.isParameter(declaration)) return declaration.type === undefined;
        return (
          ts.isVariableDeclaration(declaration) &&
          declaration.type === undefined &&
          ts.isVariableDeclarationList(declaration.parent) &&
          !(declaration.parent.flags & ts.NodeFlags.Const)
        );
      }
    }
    return ts.forEachChild(node, (child) => visit(child) || undefined) ?? false;
  }
  return visit(file);
}
