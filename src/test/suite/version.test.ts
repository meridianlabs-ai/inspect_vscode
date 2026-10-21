import * as assert from "assert";

import { coerce } from "semver";

import { VersionDescriptor } from "../../core/package/props";
import {
  hasMinimumPackageVersion,
  withMinimumPackageVersion,
} from "../../core/package/version";

// Parsed the way packageVersionDescriptor parses `<package> info version`.
const installed = (raw: string): VersionDescriptor => {
  const version = coerce(raw);
  assert.ok(version, raw);
  return { raw, version, isDeveloperBuild: raw.includes(".dev") };
};

suite("Package version gates", () => {
  test("a release at or above the minimum passes, across minor versions", () => {
    for (const raw of ["0.3.8", "0.3.10", "0.4.0", "0.5.0", "1.0.0"]) {
      assert.strictEqual(
        hasMinimumPackageVersion("0.3.8", installed(raw)),
        true,
        raw
      );
    }
  });

  test("a release below the minimum fails, and so does a missing package", () => {
    for (const raw of ["0.3.7", "0.2.99"]) {
      assert.strictEqual(
        hasMinimumPackageVersion("0.3.8", installed(raw)),
        false,
        raw
      );
    }
    assert.strictEqual(hasMinimumPackageVersion("0.3.8", null), false);
  });

  test("a developer build passes whatever its version", () => {
    assert.strictEqual(
      hasMinimumPackageVersion("0.4.0", installed("0.3.9.dev1")),
      true
    );
  });

  test("withMinimumPackageVersion returns the matching callback's result", () => {
    const gate = (raw: string | null) =>
      withMinimumPackageVersion(
        "0.4.0",
        raw === null ? null : installed(raw),
        () => "has",
        () => "lacks"
      );

    assert.strictEqual(gate("0.5.0"), "has");
    assert.strictEqual(gate("0.3.0"), "lacks");
    assert.strictEqual(gate(null), "lacks");
  });
});
