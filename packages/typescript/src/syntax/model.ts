import type { Position } from "@tint/source/text";
export interface Span {
  /** Immutable index hint, independent of source coordinates. Equality remains object identity. */
  readonly nodeHash?: number;
  readonly start: number;
  readonly end: number;
}
export type UnsupportedSyntaxFeature =
  | "template-literals"
  | "bigint-literals"
  | "regexp-literals"
  | "generator-functions"
  | "prototype-setters"
  | "computed-property-names";
export interface Diagnostic extends Span {
  /** Stable coverage identifier; unsupported input has not been certified valid. */
  readonly feature?: UnsupportedSyntaxFeature;
  readonly code:
    "LEXICAL_ERROR" | "SYNTAX_ERROR" | "UNSUPPORTED_SYNTAX" | "LIMIT";
  readonly message: string;
  readonly position: Position;
}
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Diagnostic };
export interface Token extends Span {
  readonly escaped?: boolean;
  readonly invalidEscape?: boolean;
  readonly legacyEscape?: boolean;
  readonly legacyNumeric?: boolean;
  readonly kind:
    | "identifier"
    | "private-identifier"
    | "number"
    | "bigint"
    | "regexp"
    | "string"
    | "template"
    | "template-head"
    | "template-middle"
    | "template-tail"
    | "punctuation"
    | "eof";
  readonly value: string;
  readonly lineBreakBefore: boolean;
}
export interface TypeMembers {
  readonly properties: readonly PropertySignature[];
  readonly call?: TypeNode;
  readonly construct?: TypeNode;
}
export type TypeNode = Span &
  (
    | {
        readonly kind: "named";
        readonly name: string;
        readonly arguments?: readonly TypeNode[];
      }
    | { readonly kind: "literal"; readonly value: string | number | boolean }
    | {
        readonly kind: "object";
        readonly properties: readonly PropertySignature[];
        readonly call?: TypeNode;
        readonly construct?: TypeNode;
      }
    | {
        readonly kind: "indexed-access";
        readonly object: TypeNode;
        readonly index: TypeNode;
      }
    | { readonly kind: "group"; readonly type: TypeNode }
    | {
        readonly kind: "function";
        readonly async?: boolean | undefined;
        readonly parameters: readonly Parameter[];
        readonly returnType: TypeNode;
        readonly receiver?: TypeNode;
      }
    | {
        readonly kind: "array";
        readonly element: TypeNode;
        readonly readonly?: boolean;
      }
    | {
        readonly kind: "union" | "intersection";
        readonly members: readonly TypeNode[];
      }
  );
export type Expression = Span &
  (
    | {
        readonly kind: "class-expression";
        readonly definition: ClassDefinition;
      }
    | { readonly kind: "array"; readonly elements: readonly Expression[] }
    // Array literal elisions occupy an index without creating a property.
    | { readonly kind: "elision" }
    | { readonly kind: "spread"; readonly value: Expression }
    | {
        readonly kind: "new";
        readonly callee: Expression;
        readonly typeArguments: readonly TypeNode[];
        readonly arguments: readonly Expression[];
      }
    | { readonly kind: "identifier"; readonly name: string }
    | {
        readonly kind: "object";
        readonly properties: readonly ObjectProperty[];
      }
    | {
        readonly kind: "arrow";
        readonly async?: boolean | undefined;
        readonly strict?: boolean;
        readonly parameters: readonly Parameter[];
        readonly returnType: TypeNode | undefined;
        readonly body: Expression | BlockStatement;
      }
    | {
        readonly kind: "function-expression";
        readonly async?: boolean | undefined;
        readonly generator?: boolean | undefined;
        readonly name?: string;
        readonly strict?: boolean;
        readonly receiver?: TypeNode;
        readonly parameters: readonly Parameter[];
        readonly returnType: TypeNode | undefined;
        readonly body: BlockStatement;
      }
    | { readonly kind: "number"; readonly value: number; readonly raw: string }
    | { readonly kind: "bigint"; readonly value: string; readonly raw: string }
    | {
        readonly kind: "regexp";
        readonly pattern: string;
        readonly flags: string;
      }
    | {
        readonly kind: "string";
        readonly value: string;
        readonly template?: boolean;
      }
    | TemplateExpression
    | {
        readonly kind: "tagged-template";
        readonly tag: Expression;
        readonly template: TemplateExpression;
      }
    | { readonly kind: "boolean"; readonly value: boolean }
    | { readonly kind: "null" }
    | { readonly kind: "this" }
    | { readonly kind: "super" }
    | { readonly kind: "new-target" }
    | { readonly kind: "import-meta" }
    | {
        readonly kind: "import-call";
        readonly phase: "evaluation" | "defer" | "source";
        readonly specifier: Expression;
        readonly options: Expression | undefined;
      }
    | {
        readonly kind: "private-in";
        readonly name: string;
        readonly object: Expression;
      }
    | {
        readonly kind: "unary";
        readonly operator: string;
        readonly operand: Expression;
      }
    | {
        readonly kind: "binary";
        readonly operator: string;
        readonly left: Expression;
        readonly right: Expression;
      }
    | {
        readonly kind: "update";
        readonly target: Expression;
        readonly operator: "++" | "--";
        readonly prefix: boolean;
      }
    | {
        readonly kind: "compound";
        readonly target: Expression;
        readonly operator: string;
        readonly value: Expression;
      }
    | {
        readonly kind: "assignment";
        readonly target: Expression;
        readonly value: Expression;
      }
    | {
        readonly kind: "conditional";
        readonly test: Expression;
        readonly consequent: Expression;
        readonly alternate: Expression;
      }
    | {
        readonly kind: "call";
        readonly optional?: boolean;
        readonly typeArguments?: readonly TypeNode[];
        readonly callee: Expression;
        readonly arguments: readonly Expression[];
      }
    | {
        readonly kind: "member";
        readonly private?: boolean;
        readonly optional?: boolean;
        readonly object: Expression;
        readonly property: string;
      }
    | {
        readonly kind: "index";
        readonly optional?: boolean;
        readonly object: Expression;
        readonly index: Expression;
      }
    | { readonly kind: "await"; readonly expression: Expression }
    | {
        readonly kind: "yield";
        readonly expression: Expression | undefined;
        readonly delegate: boolean;
      }
    | { readonly kind: "group"; readonly expression: Expression }
    | {
        /** `e satisfies T`, and the assertions that share its runtime
         * meaning (the operand's value): `e as T` (checked like `satisfies`
         * by typed compilation, which falls back to general semantics for
         * downcasts) and `e!` / `e as const` (type `unknown`: the operand's
         * own type is kept, so nothing non-null is assumed without proof). */
        readonly kind: "satisfies";
        readonly assertion?: "as" | "non-null";
        readonly expression: Expression;
        readonly type: TypeNode;
      }
  );
export type ObjectProperty =
  | ObjectAssignment
  | (Span & { readonly kind: "spread"; readonly value: Expression });
export interface ObjectAssignment extends Span {
  /** When present, name is only a placeholder; evaluate this key before value. */
  readonly keyExpression?: Expression;
  readonly prototypeSetter?: boolean;
  readonly accessor?: "get" | "set";
  readonly computed?: boolean;
  readonly method?: boolean;
  readonly kind?: "property";
  readonly name: string;
  readonly shorthand: boolean;
  readonly value: Expression;
}
export interface PropertySignature extends Span {
  readonly computed?: boolean;
  readonly method?: boolean;
  readonly optional?: boolean;
  readonly name: string;
  readonly readonly: boolean;
  readonly type: TypeNode;
}
export interface Binding extends Span {
  readonly kind?: "binding";
  readonly name: string;
  readonly type: TypeNode | undefined;
  readonly initializer: Expression | undefined;
}
export interface ObjectBindingProperty extends Span {
  readonly name: string;
  readonly keyExpression?: Expression;
  readonly computed?: boolean;
  readonly binding: VariableBinding;
}
export interface ObjectBinding extends Span {
  readonly kind: "object-binding";
  readonly properties: readonly ObjectBindingProperty[];
  readonly rest: Binding | undefined;
  readonly type: TypeNode | undefined;
  readonly initializer: Expression | undefined;
}
export type VariableBinding = Binding | ObjectBinding | ArrayBindingPattern;
export interface TemplateExpression extends Span {
  readonly kind: "template-expression";
  readonly parts: readonly (string | undefined)[];
  readonly raw: readonly string[];
  readonly substitutions: readonly Expression[];
}
export interface ArrayBindingPattern extends Span {
  readonly kind: "array-binding";
  readonly elements: readonly (VariableBinding | undefined)[];
  readonly rest?: VariableBinding;
  readonly type: TypeNode | undefined;
  readonly initializer: Expression | undefined;
}
export interface ParameterAttributes extends Span {
  readonly rest?: boolean;
  readonly optional?: boolean;
  readonly initializer?: Expression | undefined;
  readonly type: TypeNode | undefined;
}
export interface IdentifierParameter extends ParameterAttributes {
  readonly kind?: "binding";
  readonly name: string;
}
export interface PatternParameter extends ParameterAttributes {
  readonly kind: "pattern-parameter";
  readonly pattern: ObjectBinding | ArrayBindingPattern;
}
export type Parameter = IdentifierParameter | PatternParameter;
export interface BlockStatement extends Span {
  readonly kind: "block";
  readonly statements: readonly Statement[];
}
export interface SwitchClause extends Span {
  readonly test: Expression | undefined;
  readonly statements: readonly Statement[];
}
export interface CatchClause extends Span {
  readonly binding: VariableBinding | undefined;
  readonly body: BlockStatement;
}
export interface ClassDefinition extends Span {
  /** Start of retained class source, excluding a surrounding export wrapper. */
  readonly sourceStart?: number | undefined;
  readonly decorators?: readonly Expression[] | undefined;
  readonly name: string | undefined;
  readonly typeParameters: readonly string[];
  readonly heritage: Expression | undefined;
  readonly elements: readonly ClassElement[];
}
export type ClassElement =
  | (Span & { readonly kind: "static-block"; readonly body: BlockStatement })
  | (Span & {
      readonly key: Expression;
      readonly decorators?: readonly Expression[] | undefined;
      readonly private?: boolean;
      readonly computed: boolean;
      readonly static: boolean;
    } & (
        | {
            readonly kind: "field";
            readonly accessor?: boolean | undefined;
            readonly type: TypeNode | undefined;
            readonly initializer: Expression | undefined;
          }
        | {
            readonly kind: "method" | "get" | "set";
            /** MethodDefinition start, excluding class-element modifiers. */
            readonly sourceStart?: number | undefined;
            readonly async?: boolean | undefined;
            readonly generator?: boolean | undefined;
            readonly parameters: readonly Parameter[];
            readonly returnType: TypeNode | undefined;
            readonly body: BlockStatement;
          }
      ));
export type Statement = Span &
  (
    | {
        readonly kind: "class";
        readonly name: string;
        readonly exported: boolean;
        readonly definition: ClassDefinition;
      }
    | {
        readonly kind: "try";
        readonly body: BlockStatement;
        readonly handler: CatchClause | undefined;
        readonly finalizer: BlockStatement | undefined;
      }
    | {
        readonly kind: "switch";
        readonly expression: Expression;
        readonly clauses: readonly SwitchClause[];
      }
    | { readonly kind: "block"; readonly statements: readonly Statement[] }
    | {
        readonly kind: "interface";
        readonly call?: TypeNode;
        readonly construct?: TypeNode;
        readonly typeParameters?: readonly string[];
        readonly bases?: readonly TypeNode[];
        readonly name: string;
        readonly exported: boolean;
        readonly properties: readonly PropertySignature[];
      }
    | {
        readonly kind: "type-alias";
        readonly typeParameters?: readonly string[];
        readonly name: string;
        readonly exported: boolean;
        readonly type: TypeNode;
      }
    | { readonly kind: "throw"; readonly expression: Expression }
    | {
        readonly kind: "variable";
        readonly mode: "const" | "let" | "var";
        readonly disposal?: "sync" | "async" | undefined;
        readonly exported: boolean;
        readonly declarations: readonly VariableBinding[];
      }
    | {
        readonly kind: "function";
        /** Function source starts after export modifiers; declaration spans do not. */
        readonly sourceStart?: number | undefined;
        readonly async?: boolean | undefined;
        readonly generator?: boolean | undefined;
        readonly strict?: boolean;
        readonly typeParameters?: readonly string[];
        readonly name: string;
        readonly exported: boolean;
        readonly receiver?: TypeNode;
        readonly parameters: readonly Parameter[];
        readonly returnType: TypeNode | undefined;
        readonly body: Statement;
      }
    | {
        readonly kind: "if";
        readonly test: Expression;
        readonly consequent: Statement;
        readonly alternate: Statement | undefined;
      }
    | {
        readonly kind: "with";
        readonly object: Expression;
        readonly body: Statement;
      }
    | {
        readonly kind: "while" | "do-while";
        readonly test: Expression;
        readonly body: Statement;
      }
    | {
        /** Reference head, evaluated anew each iteration; declares no binding. */
        readonly kind: "for-in-assignment" | "for-of-assignment";
        readonly await?: boolean | undefined;
        readonly target: Expression;
        readonly iterable: Expression;
        readonly body: Statement;
      }
    | {
        readonly kind: "for-of" | "for-in";
        readonly await?: boolean | undefined;
        readonly disposal?: "sync" | "async" | undefined;
        readonly mode: "const" | "let" | "var";
        readonly binding: VariableBinding;
        readonly iterable: Expression;
        readonly body: Statement;
      }
    | {
        readonly kind: "for";
        readonly initializer: Statement | undefined;
        readonly test: Expression | undefined;
        readonly update: Expression | undefined;
        readonly body: Statement;
      }
    | { readonly kind: "return"; readonly expression: Expression | undefined }
    | {
        readonly kind: "label";
        readonly name: string;
        readonly body: Statement;
      }
    | {
        readonly kind: "break" | "continue";
        readonly label?: string | undefined;
      }
    | { readonly kind: "empty" | "debugger" }
    | { readonly kind: "expression"; readonly expression: Expression }
    | { readonly kind: "import"; readonly declaration: ImportDeclaration }
    | { readonly kind: "export"; readonly declaration: ExportDeclaration }
    | {
        readonly kind: "export-default";
        readonly declaration: boolean;
        readonly value: Expression;
      }
  );
export interface ExportBinding {
  /** Distinguishes export * as name from a named export literally called "*". */
  readonly namespace: boolean;
  readonly local: string;
  readonly exported: string;
  readonly typeOnly: boolean;
}
export interface ExportDeclaration extends Span {
  /** Undefined bindings denote an unaliased star export. */
  readonly bindings: readonly ExportBinding[] | undefined;
  readonly source: ImportDeclaration | undefined;
  readonly typeOnly: boolean;
}
export interface ImportBinding {
  /** Distinguishes import * as name from a named import literally called "*". */
  readonly namespace: boolean;
  readonly imported: string;
  readonly local: string;
  readonly typeOnly: boolean;
}
export interface ImportDeclaration extends Span {
  readonly attributes?:
    readonly { readonly key: string; readonly value: string }[] | undefined;
  readonly phase?: "defer" | "source" | undefined;
  readonly specifier: string;
  readonly specifierSpan: Span;
  readonly typeOnly: boolean;
  readonly bindings: readonly ImportBinding[];
}
export interface Module extends Span {
  /** Missing on generated legacy ASTs; parsers explicitly record the code mode. */
  readonly strict?: boolean;
  readonly statements: readonly Statement[];
  readonly imports: readonly ImportDeclaration[];
}
