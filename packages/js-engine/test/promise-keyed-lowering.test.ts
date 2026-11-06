import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoweredRealm } from "./lowered-node-host.ts";
import { promiseKeyedCases } from "./promise-keyed-cases.ts";
for (const c of promiseKeyedCases)
  test(c.name, () => {
    const realm = createLoweredRealm();
    assert.equal(
      realm.run(
        `function $DONE(e){if(e!==undefined)throw e;print('done');}` + c.source,
      ),
      "none",
    );
    realm.drain();
    assert.deepEqual(realm.printed, ["done"]);
  });
