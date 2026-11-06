# Web legacy function bindings

Sloppy block functions have a lexical binding in their block and may also update
a variable binding in the containing function or Script. Strict code keeps only
the lexical binding. Generator and async declarations do not receive this extension.

The binder determines eligibility against the original declarations. An intervening
lexical declaration or a same-named formal parameter prevents the optional var.
A simple catch parameter permits the var extension; a destructuring catch parameter
does not. Eligible vars are then included in a second binding pass so references
and closure captures resolve to their actual owner. Parameter defaults retain their
separate environment and cannot see newly introduced body vars.

Global instantiation checks ordinary declarations before creating optional vars.
A pre-existing global lexical binding or a closed global can prevent admission
without throwing. Admission is retained per name for declaration-time evaluation.
Optional bindings precede ordinary lexical, function and var initialization.

Block entry creates lexical names before constructing functions. Duplicate sloppy
functions share a binding initialized to the last declaration. Reaching a function
declaration copies the binding's **current** value into the variable environment;
mutating the binding before that declaration changes the copied value. The target
is the variable environment itself, so a surrounding `with` cannot intercept it.

Conditional function declarations use synthetic blocks. Labels remain transparent
to function-declaration collection. These rules share ordinary scope, function and
binding operations; they do not introduce a second execution engine. Native
measurements belong in the [coverage dashboard](test262.md).

Sloppy direct eval admits optional vars at runtime, during EvalDeclarationInstantiation.
The walk to the caller's variable environment skips Catch clause records. Reaching
the declaration copies into the eval caller's VariableEnvironment: the enclosing
function, arrow or parameter record when one exists, and the global object only
for global-level eval. Strict eval code or a strict caller makes no copy.

The pinned `block-decl-func-skip-arguments.js` case expects the implicit arguments
binding to prevent a copy. [Current FunctionDeclarationInstantiation](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-functiondeclarationinstantiation) distinguishes
formal parameter names from parameter-environment bindings, and permits copying
into an existing implicit arguments binding. Tint follows that rule; the unchanged
pinned test remains a reported failure. The Node reference observation and native
selection are retained separately in the [discrepancy analysis](results/test262-annexb-implicit-arguments-spec-v1.json).

## Pinned-test discrepancy

The older `block-decl-func-skip-arguments.js` expectation conflicts with current
FunctionDeclarationInstantiation: Annex B checks formal `paramNames`, while the
implicit arguments object is included in the separate `paramBindings` list.
The block function can therefore replace that implicit binding. Tint and Node
both retain the older test's failure. See the [specification comparison](results/annex-arguments-spec-analysis-v1.json);
no runtime exception is added to force this case to pass.
