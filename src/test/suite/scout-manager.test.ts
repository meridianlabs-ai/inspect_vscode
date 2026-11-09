import * as assert from "assert";

import { scoutSupportsRouteMessages } from "../../providers/scout/scout-manager";
import { installed } from "../package-version-fixture";

suite("Scout version gate", () => {
  test("enables Scout from 0.4.13 on, including later minor releases", () => {
    for (const raw of ["0.4.13", "0.4.46", "0.5.0", "0.6.0", "0.6.1.dev4"]) {
      assert.strictEqual(scoutSupportsRouteMessages(installed(raw)), true, raw);
    }
  });

  test("disables Scout before 0.4.13 or when it isn't installed", () => {
    for (const raw of ["0.3.99", "0.4.12"]) {
      assert.strictEqual(
        scoutSupportsRouteMessages(installed(raw)),
        false,
        raw
      );
    }
    assert.strictEqual(scoutSupportsRouteMessages(null), false);
  });
});
