import type {
  ArrayBindingPattern,
  BlockStatement,
  CatchClause,
  ClassDefinition,
  ClassElement,
  ExportDeclaration,
  Expression,
  ImportDeclaration,
  IndexSignature,
  Module,
  ObjectBinding,
  ObjectProperty,
  Parameter,
  PropertySignature,
  Statement,
  SwitchClause,
  TemplateExpression,
  TypeNode,
  TypeParameter,
  VariableBinding,
} from "./model.ts";

/** Receives the canonical token stream of a module. Tokens are constant
 * strings, nonnegative counts and length-prefixed texts, so a stream is
 * unambiguous without escaping. */
interface SyntaxTokenSink {
  readonly put: (token: string) => void;
  readonly count: (value: number) => void;
  readonly text: (value: string) => void;
}
function encodeSyntax(module: Module, sink: SyntaxTokenSink): void {
  function text(value: string): void {
    sink.text(value);
  }
  function flag(value: boolean | undefined): void {
    sink.put(value === undefined ? "u" : value ? "t" : "f");
  }
  function number(value: number | undefined): void {
    if (value === undefined) sink.put("u");
    else {
      sink.put("n");
      sink.count(value);
    }
  }
  function optionalText(value: string | undefined): void {
    if (value === undefined) sink.put("u");
    else text(value);
  }
  function names(values: readonly string[] | undefined): void {
    if (values === undefined) {
      sink.put("u");
      return;
    }
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key name invariant";
      text(value);
    }
  }
  function generics(values: readonly TypeParameter[] | undefined): void {
    if (values === undefined) {
      sink.put("u");
      return;
    }
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key type parameter invariant";
      text(value.name);
      optionalType(value.constraint);
      optionalType(value.defaultType);
    }
  }
  function types(values: readonly TypeNode[] | undefined): void {
    if (values === undefined) {
      sink.put("u");
      return;
    }
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key type invariant";
      type(value);
    }
  }
  function optionalType(value: TypeNode | undefined): void {
    if (value === undefined) sink.put("u");
    else type(value);
  }
  function type(node: TypeNode): void {
    sink.put("T");
    sink.put(node.kind);
    switch (node.kind) {
      case "named":
        text(node.name);
        types(node.arguments);
        return;
      case "literal":
        literal(node.value);
        return;
      case "object":
        indexSignature(node.indexSignature);
        signatures(node.properties);
        optionalType(node.call);
        optionalType(node.construct);
        return;
      case "indexed-access":
        type(node.object);
        type(node.index);
        return;
      case "group":
        type(node.type);
        return;
      case "function":
        generics(node.typeParameters);
        flag(node.async);
        parameters(node.parameters);
        type(node.returnType);
        optionalType(node.receiver);
        const predicate = node.instancePredicate;
        if (predicate !== undefined) {
          sink.put("instance-predicate");
          type(predicate);
        }
        return;
      case "tuple":
        types(node.elements);
        flag(node.readonly);
        return;
      case "array":
        type(node.element);
        flag(node.readonly);
        return;
      case "union":
      case "intersection":
        types(node.members);
        return;
    }
  }
  function indexSignature(index: IndexSignature | undefined): void {
    const signature = index;
    if (signature === undefined) return;
    sink.put("index-signature");
    text(signature.name);
    flag(signature.readonly);
    type(signature.keyType);
    type(signature.valueType);
  }
  function literal(value: string | number | boolean): void {
    if (typeof value === "string") {
      sink.put("s");
      text(value);
    } else if (typeof value === "number") number(value);
    else flag(value);
  }
  function signatures(values: readonly PropertySignature[]): void {
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key signature invariant";
      flag(value.computed);
      if (value.hasInstanceSymbol === true) sink.put("well-known:hasInstance");
      flag(value.method);
      flag(value.optional);
      text(value.name);
      flag(value.readonly);
      type(value.type);
    }
  }
  function expressions(values: readonly Expression[]): void {
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key expression invariant";
      expression(value);
    }
  }
  function optionalExpression(value: Expression | undefined): void {
    if (value === undefined) sink.put("u");
    else expression(value);
  }
  function template(node: TemplateExpression): void {
    sink.put("[");
    sink.count(node.parts.length);
    for (const part of node.parts) optionalText(part);
    names(node.raw);
    expressions(node.substitutions);
  }
  function properties(values: readonly ObjectProperty[]): void {
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key property invariant";
      if (value.kind === "spread") {
        sink.put("Pspread");
        expression(value.value);
        continue;
      }
      sink.put("Pproperty");
      optionalExpression(value.keyExpression);
      flag(value.prototypeSetter);
      optionalText(value.accessor);
      flag(value.computed);
      flag(value.method);
      text(value.name);
      flag(value.shorthand);
      expression(value.value);
    }
  }
  function expression(node: Expression): void {
    sink.put("E");
    sink.put(node.kind);
    switch (node.kind) {
      case "class-expression":
        classDefinition(node.definition);
        return;
      case "array":
        expressions(node.elements);
        return;
      case "elision":
      case "null":
      case "this":
      case "super":
      case "new-target":
      case "import-meta":
        return;
      case "spread":
        expression(node.value);
        return;
      case "new":
        expression(node.callee);
        types(node.typeArguments);
        expressions(node.arguments);
        return;
      case "identifier":
        text(node.name);
        return;
      case "object":
        properties(node.properties);
        return;
      case "arrow":
        generics(node.typeParameters);
        flag(node.async);
        flag(node.strict);
        parameters(node.parameters);
        optionalType(node.returnType);
        const body = node.body;
        if (body.kind === "block") {
          sink.put("Bblock");
          block(body);
        } else {
          sink.put("Bexpression");
          expression(body);
        }
        return;
      case "function-expression":
        generics(node.typeParameters);
        flag(node.async);
        flag(node.generator);
        optionalText(node.name);
        flag(node.strict);
        optionalType(node.receiver);
        parameters(node.parameters);
        optionalType(node.returnType);
        block(node.body);
        return;
      case "number":
        number(node.value);
        text(node.raw);
        return;
      case "bigint":
        text(node.value);
        text(node.raw);
        return;
      case "regexp":
        text(node.pattern);
        text(node.flags);
        return;
      case "string":
        text(node.value);
        flag(node.template);
        return;
      case "template-expression":
        template(node);
        return;
      case "tagged-template":
        expression(node.tag);
        template(node.template);
        return;
      case "boolean":
        flag(node.value);
        return;
      case "import-call":
        text(node.phase);
        expression(node.specifier);
        optionalExpression(node.options);
        return;
      case "private-in":
        text(node.name);
        expression(node.object);
        return;
      case "unary":
        text(node.operator);
        expression(node.operand);
        return;
      case "binary":
        text(node.operator);
        expression(node.left);
        expression(node.right);
        return;
      case "update":
        expression(node.target);
        text(node.operator);
        flag(node.prefix);
        return;
      case "compound":
        expression(node.target);
        text(node.operator);
        expression(node.value);
        return;
      case "assignment":
        expression(node.target);
        expression(node.value);
        return;
      case "conditional":
        expression(node.test);
        expression(node.consequent);
        expression(node.alternate);
        return;
      case "call":
        flag(node.optional);
        types(node.typeArguments);
        expression(node.callee);
        expressions(node.arguments);
        return;
      case "member":
        flag(node.private);
        flag(node.optional);
        expression(node.object);
        text(node.property);
        return;
      case "index":
        flag(node.optional);
        expression(node.object);
        expression(node.index);
        return;
      case "await":
        expression(node.expression);
        return;
      case "yield":
        optionalExpression(node.expression);
        flag(node.delegate);
        return;
      case "group":
        expression(node.expression);
        return;
      case "satisfies":
        expression(node.expression);
        type(node.type);
        return;
    }
  }
  function parameters(values: readonly Parameter[]): void {
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key parameter invariant";
      flag(value.rest);
      flag(value.optional);
      optionalExpression(value.initializer);
      optionalType(value.type);
      if (value.kind === "pattern-parameter") {
        sink.put("Ppattern");
        pattern(value.pattern);
      } else {
        sink.put("Pbinding");
        text(value.name);
      }
    }
  }
  function pattern(node: ObjectBinding | ArrayBindingPattern): void {
    if (node.kind === "object-binding") {
      sink.put("Vobject");
      sink.put("[");
      sink.count(node.properties.length);
      for (const property of node.properties) {
        if (property === undefined) throw "syntax key binding invariant";
        text(property.name);
        optionalExpression(property.keyExpression);
        flag(property.computed);
        binding(property.binding);
      }
      const restValue = node.rest;
      if (restValue === undefined) sink.put("u");
      else binding(restValue);
    } else {
      sink.put("Varray");
      sink.put("[");
      sink.count(node.elements.length);
      for (const element of node.elements) {
        if (element === undefined) sink.put("u");
        else binding(element);
      }
      const restValue = node.rest;
      if (restValue === undefined) sink.put("u");
      else binding(restValue);
    }
    optionalType(node.type);
    optionalExpression(node.initializer);
  }
  function binding(node: VariableBinding): void {
    if (node.kind === "object-binding" || node.kind === "array-binding") {
      pattern(node);
      return;
    }
    sink.put("Vbinding");
    text(node.name);
    optionalType(node.type);
    optionalExpression(node.initializer);
  }
  function block(node: BlockStatement): void {
    statements(node.statements);
  }
  function optionalBlock(node: BlockStatement | undefined): void {
    if (node === undefined) sink.put("u");
    else block(node);
  }
  function statements(values: readonly Statement[]): void {
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key statement invariant";
      statement(value);
    }
  }
  function optionalStatement(value: Statement | undefined): void {
    if (value === undefined) sink.put("u");
    else statement(value);
  }
  function classDefinition(node: ClassDefinition): void {
    number(node.sourceStart);
    const decoratorsValue = node.decorators;
    if (decoratorsValue === undefined) sink.put("u");
    else expressions(decoratorsValue);
    optionalText(node.name);
    generics(node.typeParameters);
    optionalExpression(node.heritage);
    sink.put("[");
    sink.count(node.elements.length);
    for (const element of node.elements) {
      if (element === undefined) throw "syntax key class invariant";
      classElement(element);
    }
  }
  function classElement(node: ClassElement): void {
    sink.put("C");
    sink.put(node.kind);
    if (node.kind === "static-block") {
      block(node.body);
      return;
    }
    expression(node.key);
    const decoratorsValue = node.decorators;
    if (decoratorsValue === undefined) sink.put("u");
    else expressions(decoratorsValue);
    flag(node.private);
    flag(node.computed);
    flag(node.static);
    if (node.kind === "field") {
      flag(node.accessor);
      optionalType(node.type);
      optionalExpression(node.initializer);
      return;
    }
    number(node.sourceStart);
    flag(node.async);
    flag(node.generator);
    generics(node.typeParameters);
    parameters(node.parameters);
    optionalType(node.returnType);
    block(node.body);
  }
  function clauses(values: readonly SwitchClause[]): void {
    sink.put("[");
    sink.count(values.length);
    for (const value of values) {
      if (value === undefined) throw "syntax key clause invariant";
      optionalExpression(value.test);
      statements(value.statements);
    }
  }
  function handler(node: CatchClause | undefined): void {
    if (node === undefined) {
      sink.put("u");
      return;
    }
    const bindingValue = node.binding;
    if (bindingValue === undefined) sink.put("u");
    else binding(bindingValue);
    block(node.body);
  }
  function importDeclaration(node: ImportDeclaration): void {
    const attributes = node.attributes;
    if (attributes === undefined) sink.put("u");
    else {
      sink.put("[");
      sink.count(attributes.length);
      for (const attribute of attributes) {
        if (attribute === undefined) throw "syntax key attribute invariant";
        text(attribute.key);
        text(attribute.value);
      }
    }
    optionalText(node.phase);
    text(node.specifier);
    flag(node.typeOnly);
    sink.put("[");
    sink.count(node.bindings.length);
    for (const item of node.bindings) {
      if (item === undefined) throw "syntax key import invariant";
      flag(item.namespace);
      text(item.imported);
      text(item.local);
      flag(item.typeOnly);
    }
  }
  function exportDeclaration(node: ExportDeclaration): void {
    const bindings = node.bindings;
    if (bindings === undefined) sink.put("u");
    else {
      sink.put("[");
      sink.count(bindings.length);
      for (const item of bindings) {
        if (item === undefined) throw "syntax key export invariant";
        flag(item.namespace);
        text(item.local);
        text(item.exported);
        flag(item.typeOnly);
      }
    }
    const sourceValue = node.source;
    if (sourceValue === undefined) sink.put("u");
    else importDeclaration(sourceValue);
    flag(node.typeOnly);
  }
  function statement(node: Statement): void {
    sink.put("S");
    sink.put(node.kind);
    switch (node.kind) {
      case "class":
        text(node.name);
        flag(node.exported);
        classDefinition(node.definition);
        return;
      case "try":
        block(node.body);
        handler(node.handler);
        optionalBlock(node.finalizer);
        return;
      case "switch":
        expression(node.expression);
        clauses(node.clauses);
        return;
      case "block":
        statements(node.statements);
        return;
      case "interface":
        optionalType(node.call);
        optionalType(node.construct);
        generics(node.typeParameters);
        types(node.bases);
        text(node.name);
        flag(node.exported);
        indexSignature(node.indexSignature);
        signatures(node.properties);
        return;
      case "type-alias":
        generics(node.typeParameters);
        text(node.name);
        flag(node.exported);
        type(node.type);
        return;
      case "throw":
        expression(node.expression);
        return;
      case "variable":
        text(node.mode);
        optionalText(node.disposal);
        flag(node.exported);
        sink.put("[");
        sink.count(node.declarations.length);
        for (const declaration of node.declarations) {
          if (declaration === undefined)
            throw "syntax key declaration invariant";
          binding(declaration);
        }
        return;
      case "function":
        number(node.sourceStart);
        flag(node.async);
        flag(node.generator);
        flag(node.strict);
        generics(node.typeParameters);
        text(node.name);
        flag(node.exported);
        optionalType(node.receiver);
        parameters(node.parameters);
        optionalType(node.returnType);
        statement(node.body);
        return;
      case "if":
        expression(node.test);
        statement(node.consequent);
        optionalStatement(node.alternate);
        return;
      case "with":
        expression(node.object);
        statement(node.body);
        return;
      case "while":
      case "do-while":
        expression(node.test);
        statement(node.body);
        return;
      case "for-in-assignment":
      case "for-of-assignment":
        flag(node.await);
        expression(node.target);
        expression(node.iterable);
        statement(node.body);
        return;
      case "for-of":
      case "for-in":
        flag(node.await);
        optionalText(node.disposal);
        text(node.mode);
        binding(node.binding);
        expression(node.iterable);
        statement(node.body);
        return;
      case "for":
        optionalStatement(node.initializer);
        optionalExpression(node.test);
        optionalExpression(node.update);
        statement(node.body);
        return;
      case "return":
        optionalExpression(node.expression);
        return;
      case "label":
        text(node.name);
        statement(node.body);
        return;
      case "break":
      case "continue":
        optionalText(node.label);
        return;
      case "empty":
      case "debugger":
        return;
      case "expression":
        expression(node.expression);
        return;
      case "import":
        importDeclaration(node.declaration);
        return;
      case "export":
        exportDeclaration(node.declaration);
        return;
      case "export-default":
        flag(node.declaration);
        expression(node.value);
        return;
    }
  }
  flag(module.strict);
  sink.put("[");
  sink.count(module.imports.length);
  for (const declaration of module.imports) {
    if (declaration === undefined) throw "syntax key module import invariant";
    importDeclaration(declaration);
  }
  statements(module.statements);
}
/** Decimal digits of a small nonnegative integer (exact digit arithmetic),
 * or -1 for numbers compared through their string form. */
function digitCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 1000000000)
    return -1;
  let digits = 1;
  for (let rest = value; rest >= 10; rest = Math.floor(rest / 10)) digits++;
  return digits;
}
/** A canonical key of every semantic field of a module: node kinds, names,
 * literal values, operators, flags, types and child order. Source spans and
 * per-traversal node hashes are excluded; retained source offsets
 * (`sourceStart`) are included. Equal keys denote syntax that differs at most
 * in those excluded positions. Strings are length-prefixed, so no value can
 * imitate structure. */
export function syntaxKey(module: Module): string {
  const parts: string[] = [];
  encodeSyntax(module, {
    put: (token) => {
      parts.push(token);
    },
    count: (value) => {
      parts.push(String(value));
    },
    text: (value) => {
      parts.push(String(value.length));
      parts.push(value);
    },
  });
  return parts.join("|");
}
/** A 32-bit digest of the same token stream, computed without building the
 * key. Equal syntax has equal digests; matches must still be verified. */
export function syntaxKeyHash(module: Module): number {
  let hash = 2166136261;
  function unit(code: number): void {
    hash = Math.imul(hash ^ code, 16777619) >>> 0;
  }
  function chars(value: string): void {
    for (let index = 0; index < value.length; index++)
      unit(value.charCodeAt(index));
    unit(124);
  }
  function count(value: number): void {
    if (digitCount(value) < 0) chars(String(value));
    else {
      unit(value % 65536);
      unit(Math.floor(value / 65536) % 65536);
      unit(124);
    }
  }
  encodeSyntax(module, {
    put: chars,
    count,
    text: (value) => {
      count(value.length);
      chars(value);
    },
  });
  return hash;
}
/** Whether a module's token stream equals a key produced by syntaxKey,
 * compared in place without building another key. */
export function syntaxKeyMatches(module: Module, key: string): boolean {
  let cursor = 0,
    started = false,
    equal = true;
  function separator(): void {
    if (!started) {
      started = true;
      return;
    }
    if (key.charCodeAt(cursor) !== 124) equal = false;
    cursor++;
  }
  function put(token: string): void {
    if (!equal) return;
    separator();
    if (cursor + token.length > key.length) {
      equal = false;
      return;
    }
    for (let index = 0; index < token.length; index++)
      if (key.charCodeAt(cursor + index) !== token.charCodeAt(index)) {
        equal = false;
        return;
      }
    cursor += token.length;
  }
  function count(value: number): void {
    if (!equal) return;
    const digits = digitCount(value);
    if (digits < 0) {
      put(String(value));
      return;
    }
    separator();
    let scale = 1;
    for (let index = 1; index < digits; index++) scale *= 10;
    for (let rest = value; scale >= 1; scale = scale / 10) {
      const digit = Math.floor(rest / scale);
      if (key.charCodeAt(cursor) !== 48 + digit) {
        equal = false;
        return;
      }
      rest -= digit * scale;
      cursor++;
    }
  }
  encodeSyntax(module, {
    put,
    count,
    text: (value) => {
      count(value.length);
      put(value);
    },
  });
  return equal && cursor === key.length;
}
