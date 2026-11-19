import type {
  Binding,
  VariableBinding,
  Expression,
  Parameter,
  IdentifierParameter,
  TypeParameters,
} from "./model.ts";

export function parameterIdentifiers(
  parameter: Parameter,
): readonly (Binding | IdentifierParameter)[] {
  return parameter.kind === "pattern-parameter"
    ? bindingIdentifiers(parameter.pattern)
    : [parameter];
}

export function visitParameterExpressions(
  parameter: Parameter,
  visit: (expression: Expression) => void,
): void {
  if (parameter.initializer !== undefined) visit(parameter.initializer);
  if (parameter.kind === "pattern-parameter")
    visitBindingExpressions(parameter.pattern, visit);
}

export function parameterHasExpressions(parameter: Parameter): boolean {
  let found = false;
  visitParameterExpressions(parameter, (_expression) => {
    found = true;
  });
  return found;
}

export function isSimpleParameter(parameter: Parameter): boolean {
  return (
    parameter.kind !== "pattern-parameter" &&
    !parameter.rest &&
    parameter.initializer === undefined
  );
}

/** BoundNames in declaration order, preserving identifier node identity. */
export function bindingIdentifiers(
  binding: VariableBinding,
): readonly Binding[] {
  const identifiers: Binding[] = [];
  function visit(node: VariableBinding): void {
    if (node.kind === "array-binding") {
      for (const element of node.elements)
        if (element !== undefined) visit(element);
      if (node.rest !== undefined) visit(node.rest);
      return;
    }
    if (node.kind !== "object-binding") {
      identifiers.push(node);
      return;
    }
    for (const property of node.properties) {
      if (property === undefined) throw "BINDING_PROPERTY_INVARIANT";
      visit(property.binding);
    }
    if (node.rest !== undefined) identifiers.push(node.rest);
  }
  visit(binding);
  return identifiers;
}

/** Visit source/default expressions and computed keys in evaluation order. */
export function visitBindingExpressions(
  binding: VariableBinding,
  visit: (expression: Expression) => void,
): void {
  if (binding.initializer !== undefined) visit(binding.initializer);
  if (binding.kind === "array-binding") {
    for (const element of binding.elements)
      if (element !== undefined) visitBindingExpressions(element, visit);
    if (binding.rest !== undefined)
      visitBindingExpressions(binding.rest, visit);
    return;
  }
  if (binding.kind !== "object-binding") return;
  for (const property of binding.properties) {
    if (property === undefined) throw "BINDING_PROPERTY_INVARIANT";
    if (property.keyExpression !== undefined) visit(property.keyExpression);
    visitBindingExpressions(property.binding, visit);
  }
}

/** ExpectedArgumentCount: patterns count once; the first default or rest ends arity. */
export function expectedArgumentCount(
  parameters: readonly Parameter[],
): number {
  let length = 0;
  for (const parameter of parameters) {
    if (parameter === undefined) throw "SYNTAX_PARAMETER_INVARIANT";
    if (parameter.rest || parameter.initializer !== undefined) break;
    length++;
  }
  return length;
}

// A generic list has the same contract in declaration, expression and type syntax.
export function typeParameterCount(
  parameters: TypeParameters | undefined,
): number {
  return parameters === undefined ? 0 : parameters.length;
}
