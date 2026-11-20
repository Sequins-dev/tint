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
export interface SourceAdvisory extends SourceDiagnostic {
  readonly reason:
    | "open-assignment"
    | "open-constructor-field"
    | "open-list-argument"
    | "open-assertion"
    | "open-comparison";
}

const advisories = new Map<number, SourceAdvisory["reason"]>([
  [2322, "open-assignment"],
  [2339, "open-constructor-field"],
  [2345, "open-list-argument"],
  [2352, "open-assertion"],
  [2367, "open-comparison"],
]);

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
  onAdvisory?: (diagnostic: SourceAdvisory) => void,
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
    const diagnostics = validate(
      file,
      byId,
      byFile,
      compilerOptions,
      onAdvisory,
    );
    verdicts.set(entry, diagnostics);
    return diagnostics;
  };
}

function validate(
  entry: string,
  byId: ReadonlyMap<string, string>,
  byFile: ReadonlyMap<string, HostedValidationSource>,
  options: ts.CompilerOptions,
  onAdvisory: ((diagnostic: SourceAdvisory) => void) | undefined,
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
  function report(
    diagnostic: ts.Diagnostic,
    advisory?: SourceAdvisory["reason"],
  ): void {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) return;
    const start = diagnostic.start ?? 0;
    const sourceDiagnostic: SourceDiagnostic = {
      code: "TS" + diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      module:
        (diagnostic.file && byFile.get(diagnostic.file.fileName)?.id) ??
        byFile.get(entry)!.id,
      start,
      end: start + (diagnostic.length ?? 0),
    };
    if (advisory === undefined) diagnostics.push(sourceDiagnostic);
    else onAdvisory?.({ ...sourceDiagnostic, reason: advisory });
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
      for (const error of program.getSemanticDiagnostics(file)) {
        const reason = advisories.get(error.code);
        report(
          error,
          reason !== undefined &&
            isOpenSlotDiagnostic(error, file, program, checker)
            ? reason
            : undefined,
        );
      }
  }
  return diagnostics;
}

function isOpenSlotDiagnostic(
  diagnostic: ts.Diagnostic,
  file: ts.SourceFile,
  program: ts.Program,
  checker: ts.TypeChecker,
): boolean {
  const { code, start } = diagnostic;
  if (start === undefined) return false;
  const end = start + (diagnostic.length ?? 0);
  const diagnosticStart: number = start;
  const matches = (node: ts.Node) =>
    node.getStart(file) === start && node.end === end;

  function inferredVariable(
    node: ts.Expression,
  ): ts.VariableDeclaration | undefined {
    if (!ts.isIdentifier(node)) return undefined;
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    return declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.type === undefined
      ? declaration
      : undefined;
  }

  function openList(node: ts.Expression): boolean {
    const initializer = inferredVariable(node)?.initializer;
    return (
      initializer !== undefined &&
      ts.isArrayLiteralExpression(initializer) &&
      checker.isArrayType(checker.getTypeAtLocation(node))
    );
  }

  function constructorField(target: ts.PropertyAccessExpression): boolean {
    const receiver = checker.getTypeAtLocation(target.expression);
    const declaration = receiver.getSymbol()?.valueDeclaration;
    if (declaration === undefined || !ts.isClassLike(declaration)) return false;
    const key = target.name.text;
    return declaration.members.some(
      (member) =>
        ts.isConstructorDeclaration(member) &&
        member.body?.statements.some((statement) => {
          if (!ts.isExpressionStatement(statement)) return false;
          const assignment = statement.expression;
          return (
            ts.isBinaryExpression(assignment) &&
            assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(assignment.left) &&
            assignment.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
            assignment.left.name.text === key
          );
        }) === true,
    );
  }

  function openSlot(target: ts.Expression): boolean {
    while (ts.isParenthesizedExpression(target)) target = target.expression;
    if (ts.isPropertyAccessExpression(target)) {
      const field = checker.getSymbolAtLocation(target.name)?.valueDeclaration;
      if (field === undefined) return false;
      if (ts.isPropertyDeclaration(field))
        return (
          field.type === undefined &&
          !field.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.OverrideKeyword,
          )
        );
      return (
        ts.isPropertyAssignment(field) &&
        inferredVariable(target.expression)?.initializer === field.parent &&
        checker.getContextualType(field.parent) === undefined
      );
    }
    if (ts.isElementAccessExpression(target))
      return (
        openList(target.expression) &&
        (checker.getTypeAtLocation(target.argumentExpression).flags &
          ts.TypeFlags.NumberLike) !==
          0
      );
    if (!ts.isIdentifier(target)) return false;
    const declaration = checker.getSymbolAtLocation(target)?.valueDeclaration;
    if (declaration !== undefined && ts.isParameter(declaration))
      return declaration.type === undefined;
    const variable = inferredVariable(target);
    return (
      variable !== undefined &&
      ts.isVariableDeclarationList(variable.parent) &&
      !(variable.parent.flags & ts.NodeFlags.Const)
    );
  }

  function visit(node: ts.Node): boolean {
    if (node.getStart(file) > diagnosticStart || node.end < end) return false;
    if (
      code === 2339 &&
      ts.isPropertyAccessExpression(node) &&
      matches(node.name)
    )
      return constructorField(node);
    if (
      code === 2352 &&
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      matches(node)
    )
      return openSlot(node.expression);
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        code === 2322 &&
        operator === ts.SyntaxKind.EqualsToken &&
        matches(node.left)
      )
        return openSlot(node.left);
      if (
        code === 2367 &&
        matches(node) &&
        (operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          operator === ts.SyntaxKind.ExclamationEqualsEqualsToken)
      )
        return openSlot(node.left) || openSlot(node.right);
    }
    if (
      code === 2345 &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "push" &&
      openList(node.expression.expression) &&
      node.arguments.some(matches)
    ) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      return (
        declaration !== undefined &&
        program.isSourceFileDefaultLibrary(declaration.getSourceFile()) &&
        ts.isInterfaceDeclaration(declaration.parent) &&
        declaration.parent.name.text === "Array"
      );
    }
    return ts.forEachChild(node, (child) => visit(child) || undefined) ?? false;
  }
  return visit(file);
}
