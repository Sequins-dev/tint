import type { Expression } from "@tint/typescript/syntax";
export function isPureNumericInitializer(node: Expression): boolean {
  if (node.kind === "number") return true;
  if (node.kind === "group") return isPureNumericInitializer(node.expression);
  if (node.kind === "unary")
    return (
      ["+", "-", "~"].includes(node.operator) &&
      isPureNumericInitializer(node.operand)
    );
  return (
    node.kind === "binary" &&
    ["+", "-", "*", "/", "%", "**", "<<", ">>", ">>>", "&", "|", "^"].includes(
      node.operator,
    ) &&
    isPureNumericInitializer(node.left) &&
    isPureNumericInitializer(node.right)
  );
}
