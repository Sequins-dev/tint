import type {
  ArrayBindingPattern,
  BlockStatement,
  CatchClause,
  ClassDefinition,
  ClassElement,
  ExportDeclaration,
  Expression,
  ImportDeclaration,
  Module,
  ObjectBinding,
  ObjectProperty,
  Parameter,
  PropertySignature,
  Statement,
  SwitchClause,
  TemplateExpression,
  TypeNode,
  VariableBinding,
} from "./model.ts";

/** A canonical key of every semantic field of a module: node kinds, names,
 * literal values, operators, flags, types and child order. Source spans and
 * per-traversal node hashes are excluded; retained source offsets
 * (`sourceStart`) are included. Equal keys denote syntax that differs at most
 * in those excluded positions. Strings are length-prefixed, so no value can
 * imitate structure. */
export function syntaxKey(module: Module): string {
  const parts: string[] = [];
  function text(value: string): void {
    parts.push(String(value.length) + ":" + value);
  }
  function flag(value: boolean | undefined): void {
    parts.push(value === undefined ? "u" : value ? "t" : "f");
  }
  function number(value: number | undefined): void {
    parts.push(value === undefined ? "u" : "n" + String(value));
  }
  function optionalText(value: string | undefined): void {
    if (value === undefined) parts.push("u");
    else text(value);
  }
  function names(values: readonly string[] | undefined): void {
    if (values === undefined) {
      parts.push("u");
      return;
    }
    parts.push("[" + String(values.length));
    for (const value of values) {
      if (value === undefined) throw "syntax key name invariant";
      text(value);
    }
  }
  function types(values: readonly TypeNode[] | undefined): void {
    if (values === undefined) {
      parts.push("u");
      return;
    }
    parts.push("[" + String(values.length));
    for (const value of values) {
      if (value === undefined) throw "syntax key type invariant";
      type(value);
    }
  }
  function optionalType(value: TypeNode | undefined): void {
    if (value === undefined) parts.push("u");
    else type(value);
  }
  function type(node: TypeNode): void {
    parts.push("T" + node.kind);
    switch (node.kind) {
      case "named":
        text(node.name);
        types(node.arguments);
        return;
      case "literal":
        literal(node.value);
        return;
      case "object":
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
        flag(node.async);
        parameters(node.parameters);
        type(node.returnType);
        optionalType(node.receiver);
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
  function literal(value: string | number | boolean): void {
    if (typeof value === "string") {
      parts.push("s");
      text(value);
    } else if (typeof value === "number") number(value);
    else flag(value);
  }
  function signatures(values: readonly PropertySignature[]): void {
    parts.push("[" + String(values.length));
    for (const value of values) {
      if (value === undefined) throw "syntax key signature invariant";
      flag(value.computed);
      flag(value.method);
      flag(value.optional);
      text(value.name);
      flag(value.readonly);
      type(value.type);
    }
  }
  function expressions(values: readonly Expression[]): void {
    parts.push("[" + String(values.length));
    for (const value of values) {
      if (value === undefined) throw "syntax key expression invariant";
      expression(value);
    }
  }
  function optionalExpression(value: Expression | undefined): void {
    if (value === undefined) parts.push("u");
    else expression(value);
  }
  function template(node: TemplateExpression): void {
    parts.push("[" + String(node.parts.length));
    for (const part of node.parts) optionalText(part);
    names(node.raw);
    expressions(node.substitutions);
  }
  function properties(values: readonly ObjectProperty[]): void {
    parts.push("[" + String(values.length));
    for (const value of values) {
      if (value === undefined) throw "syntax key property invariant";
      if (value.kind === "spread") {
        parts.push("Pspread");
        expression(value.value);
        continue;
      }
      parts.push("Pproperty");
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
    parts.push("E" + node.kind);
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
        flag(node.async);
        flag(node.strict);
        parameters(node.parameters);
        optionalType(node.returnType);
        const body = node.body;
        if (body.kind === "block") {
          parts.push("Bblock");
          block(body);
        } else {
          parts.push("Bexpression");
          expression(body);
        }
        return;
      case "function-expression":
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
    parts.push("[" + String(values.length));
    for (const value of values) {
      if (value === undefined) throw "syntax key parameter invariant";
      flag(value.rest);
      flag(value.optional);
      optionalExpression(value.initializer);
      optionalType(value.type);
      if (value.kind === "pattern-parameter") {
        parts.push("Ppattern");
        pattern(value.pattern);
      } else {
        parts.push("Pbinding");
        text(value.name);
      }
    }
  }
  function pattern(node: ObjectBinding | ArrayBindingPattern): void {
    if (node.kind === "object-binding") {
      parts.push("Vobject");
      parts.push("[" + String(node.properties.length));
      for (const property of node.properties) {
        if (property === undefined) throw "syntax key binding invariant";
        text(property.name);
        optionalExpression(property.keyExpression);
        flag(property.computed);
        binding(property.binding);
      }
      const restValue = node.rest;
      if (restValue === undefined) parts.push("u");
      else binding(restValue);
    } else {
      parts.push("Varray");
      parts.push("[" + String(node.elements.length));
      for (const element of node.elements) {
        if (element === undefined) parts.push("u");
        else binding(element);
      }
      const restValue = node.rest;
      if (restValue === undefined) parts.push("u");
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
    parts.push("Vbinding");
    text(node.name);
    optionalType(node.type);
    optionalExpression(node.initializer);
  }
  function block(node: BlockStatement): void {
    statements(node.statements);
  }
  function optionalBlock(node: BlockStatement | undefined): void {
    if (node === undefined) parts.push("u");
    else block(node);
  }
  function statements(values: readonly Statement[]): void {
    parts.push("[" + String(values.length));
    for (const value of values) {
      if (value === undefined) throw "syntax key statement invariant";
      statement(value);
    }
  }
  function optionalStatement(value: Statement | undefined): void {
    if (value === undefined) parts.push("u");
    else statement(value);
  }
  function classDefinition(node: ClassDefinition): void {
    number(node.sourceStart);
    const decoratorsValue = node.decorators;
    if (decoratorsValue === undefined) parts.push("u");
    else expressions(decoratorsValue);
    optionalText(node.name);
    names(node.typeParameters);
    optionalExpression(node.heritage);
    parts.push("[" + String(node.elements.length));
    for (const element of node.elements) {
      if (element === undefined) throw "syntax key class invariant";
      classElement(element);
    }
  }
  function classElement(node: ClassElement): void {
    parts.push("C" + node.kind);
    if (node.kind === "static-block") {
      block(node.body);
      return;
    }
    expression(node.key);
    const decoratorsValue = node.decorators;
    if (decoratorsValue === undefined) parts.push("u");
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
    parameters(node.parameters);
    optionalType(node.returnType);
    block(node.body);
  }
  function clauses(values: readonly SwitchClause[]): void {
    parts.push("[" + String(values.length));
    for (const value of values) {
      if (value === undefined) throw "syntax key clause invariant";
      optionalExpression(value.test);
      statements(value.statements);
    }
  }
  function handler(node: CatchClause | undefined): void {
    if (node === undefined) {
      parts.push("u");
      return;
    }
    const bindingValue = node.binding;
    if (bindingValue === undefined) parts.push("u");
    else binding(bindingValue);
    block(node.body);
  }
  function importDeclaration(node: ImportDeclaration): void {
    const attributes = node.attributes;
    if (attributes === undefined) parts.push("u");
    else {
      parts.push("[" + String(attributes.length));
      for (const attribute of attributes) {
        if (attribute === undefined) throw "syntax key attribute invariant";
        text(attribute.key);
        text(attribute.value);
      }
    }
    optionalText(node.phase);
    text(node.specifier);
    flag(node.typeOnly);
    parts.push("[" + String(node.bindings.length));
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
    if (bindings === undefined) parts.push("u");
    else {
      parts.push("[" + String(bindings.length));
      for (const item of bindings) {
        if (item === undefined) throw "syntax key export invariant";
        flag(item.namespace);
        text(item.local);
        text(item.exported);
        flag(item.typeOnly);
      }
    }
    const sourceValue = node.source;
    if (sourceValue === undefined) parts.push("u");
    else importDeclaration(sourceValue);
    flag(node.typeOnly);
  }
  function statement(node: Statement): void {
    parts.push("S" + node.kind);
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
        names(node.typeParameters);
        types(node.bases);
        text(node.name);
        flag(node.exported);
        signatures(node.properties);
        return;
      case "type-alias":
        names(node.typeParameters);
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
        parts.push("[" + String(node.declarations.length));
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
        names(node.typeParameters);
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
  parts.push("[" + String(module.imports.length));
  for (const declaration of module.imports) {
    if (declaration === undefined) throw "syntax key module import invariant";
    importDeclaration(declaration);
  }
  statements(module.statements);
  return parts.join("|");
}
