import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    `const other=$262.createRealm().global;const target=other.Function("return this;");target.prototype=null;const f=Reflect.construct(Function,["return this;"],target);if(Object.getPrototypeOf(f)!==other.Function.prototype||f()!==globalThis)throw 1;`,
    `const other=$262.createRealm().global;const f=other.Function("return this;");if(f()!==other||f.call(null)!==other||f.call(undefined)!==other)throw 1;const strict=other.Function("'use strict';return this;");if(strict.call(globalThis)!==globalThis||strict()!==undefined)throw 2;`,
  ],
  { nodeReference: false },
);
