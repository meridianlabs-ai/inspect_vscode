import * as assert from "assert";

import { kMethodHttpRequest } from "../../core/jsonrpc";
import { logviewHostCapabilities } from "../../providers/logview/logview-panel";

suite("Logview Panel Test Suite", () => {
  test("advertises the generic proxy only with scoped authorization", () => {
    assert.deepStrictEqual(logviewHostCapabilities(false), []);
    assert.deepStrictEqual(logviewHostCapabilities(true), [kMethodHttpRequest]);
  });
});
