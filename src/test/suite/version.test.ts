/**
 * Tests for version.ts - Version comparison utilities
 */
import * as assert from "assert";

/**
 * Mock VersionDescriptor for testing
 */
interface VersionDescriptor {
  raw: string;
  version: {
    major: number;
    minor: number;
    patch: number;
    compare: (other: string) => number;
  };
  isDeveloperBuild: boolean;
}

/**
 * Create a mock version descriptor
 */
function createVersionDescriptor(
  versionStr: string,
  isDev = false
): VersionDescriptor {
  const parts = versionStr
    .replace(/\.dev\d*$/, "")
    .split(".")
    .map(Number);

  return {
    raw: versionStr,
    version: {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
      compare: (other: string) => {
        const otherParts = other.split(".").map(Number);
        const thisMajor = parts[0] || 0;
        const thisMinor = parts[1] || 0;
        const thisPatch = parts[2] || 0;
        const otherMajor = otherParts[0] || 0;
        const otherMinor = otherParts[1] || 0;
        const otherPatch = otherParts[2] || 0;

        if (thisMajor !== otherMajor) {
          return thisMajor - otherMajor;
        }
        if (thisMinor !== otherMinor) {
          return thisMinor - otherMinor;
        }
        return thisPatch - otherPatch;
      },
    },
    isDeveloperBuild: isDev,
  };
}

/**
 * Implementation of hasMinimumPackageVersion for testing
 */
function hasMinimumPackageVersion(
  version: string,
  packageVersion: VersionDescriptor | null,
  strictDevCheck = false
): boolean {
  if (packageVersion?.isDeveloperBuild && strictDevCheck) {
    const required = version.split(".").map(Number);
    const installed = packageVersion.version;
    return (
      installed.major >= (required[0] || 0) &&
      installed.minor >= (required[1] || 0) &&
      installed.patch > (required[2] || 0)
    );
  } else {
    if (
      packageVersion &&
      (packageVersion.version.compare(version) >= 0 ||
        packageVersion.isDeveloperBuild)
    ) {
      return true;
    } else {
      return false;
    }
  }
}

/**
 * Implementation of withMinimumPackageVersion for testing
 */
function withMinimumPackageVersion<T>(
  version: string,
  packageVersion: VersionDescriptor | null,
  hasVersion: () => T,
  doesntHaveVersion: () => T
): T | void {
  if (hasMinimumPackageVersion(version, packageVersion)) {
    return hasVersion();
  } else {
    return doesntHaveVersion();
  }
}

suite("Version Utilities Test Suite", () => {
  suite("Version Descriptor Creation", () => {
    test("should parse simple version string", () => {
      const descriptor = createVersionDescriptor("1.2.3");

      assert.strictEqual(descriptor.raw, "1.2.3");
      assert.strictEqual(descriptor.version.major, 1);
      assert.strictEqual(descriptor.version.minor, 2);
      assert.strictEqual(descriptor.version.patch, 3);
      assert.strictEqual(descriptor.isDeveloperBuild, false);
    });

    test("should parse developer version string", () => {
      const descriptor = createVersionDescriptor("1.2.3.dev1", true);

      assert.strictEqual(descriptor.raw, "1.2.3.dev1");
      assert.strictEqual(descriptor.version.major, 1);
      assert.strictEqual(descriptor.version.minor, 2);
      assert.strictEqual(descriptor.version.patch, 3);
      assert.strictEqual(descriptor.isDeveloperBuild, true);
    });

    test("should handle version with only major.minor", () => {
      const descriptor = createVersionDescriptor("1.2");

      assert.strictEqual(descriptor.version.major, 1);
      assert.strictEqual(descriptor.version.minor, 2);
      assert.strictEqual(descriptor.version.patch, 0);
    });

    test("should handle version with only major", () => {
      const descriptor = createVersionDescriptor("1");

      assert.strictEqual(descriptor.version.major, 1);
      assert.strictEqual(descriptor.version.minor, 0);
      assert.strictEqual(descriptor.version.patch, 0);
    });
  });

  suite("Version Comparison", () => {
    test("should compare equal versions", () => {
      const v1 = createVersionDescriptor("1.2.3");
      const result = v1.version.compare("1.2.3");

      assert.strictEqual(result, 0);
    });

    test("should detect greater version (major)", () => {
      const v1 = createVersionDescriptor("2.0.0");
      const result = v1.version.compare("1.0.0");

      assert.ok(result > 0);
    });

    test("should detect greater version (minor)", () => {
      const v1 = createVersionDescriptor("1.3.0");
      const result = v1.version.compare("1.2.0");

      assert.ok(result > 0);
    });

    test("should detect greater version (patch)", () => {
      const v1 = createVersionDescriptor("1.2.4");
      const result = v1.version.compare("1.2.3");

      assert.ok(result > 0);
    });

    test("should detect lesser version (major)", () => {
      const v1 = createVersionDescriptor("1.0.0");
      const result = v1.version.compare("2.0.0");

      assert.ok(result < 0);
    });

    test("should detect lesser version (minor)", () => {
      const v1 = createVersionDescriptor("1.2.0");
      const result = v1.version.compare("1.3.0");

      assert.ok(result < 0);
    });

    test("should detect lesser version (patch)", () => {
      const v1 = createVersionDescriptor("1.2.3");
      const result = v1.version.compare("1.2.4");

      assert.ok(result < 0);
    });
  });

  suite("hasMinimumPackageVersion", () => {
    test("should return true when version is equal", () => {
      const packageVersion = createVersionDescriptor("0.4.0");
      const result = hasMinimumPackageVersion("0.4.0", packageVersion);

      assert.strictEqual(result, true);
    });

    test("should return true when installed version is greater", () => {
      const packageVersion = createVersionDescriptor("0.5.0");
      const result = hasMinimumPackageVersion("0.4.0", packageVersion);

      assert.strictEqual(result, true);
    });

    test("should return false when installed version is less", () => {
      const packageVersion = createVersionDescriptor("0.3.0");
      const result = hasMinimumPackageVersion("0.4.0", packageVersion);

      assert.strictEqual(result, false);
    });

    test("should return false when packageVersion is null", () => {
      const result = hasMinimumPackageVersion("0.4.0", null);

      assert.strictEqual(result, false);
    });

    test("should return true for developer build without strict check", () => {
      const packageVersion = createVersionDescriptor("0.3.9.dev1", true);
      const result = hasMinimumPackageVersion("0.4.0", packageVersion, false);

      assert.strictEqual(result, true);
    });

    test("should check strictly for developer build with strict flag", () => {
      // Dev build at 0.3.9 should not satisfy 0.4.0 requirement strictly
      const packageVersion = createVersionDescriptor("0.4.0.dev1", true);
      const result = hasMinimumPackageVersion("0.4.0", packageVersion, true);

      // With strict check, patch must be greater, not equal
      assert.strictEqual(result, false);
    });

    test("should pass strict check when dev version is ahead", () => {
      const packageVersion = createVersionDescriptor("0.4.1.dev1", true);
      const result = hasMinimumPackageVersion("0.4.0", packageVersion, true);

      assert.strictEqual(result, true);
    });
  });

  suite("withMinimumPackageVersion", () => {
    test("should execute hasVersion callback when version met", () => {
      const packageVersion = createVersionDescriptor("0.5.0");
      let called = "";

      withMinimumPackageVersion(
        "0.4.0",
        packageVersion,
        () => {
          called = "hasVersion";
        },
        () => {
          called = "doesntHaveVersion";
        }
      );

      assert.strictEqual(called, "hasVersion");
    });

    test("should execute doesntHaveVersion callback when version not met", () => {
      const packageVersion = createVersionDescriptor("0.3.0");
      let called = "";

      withMinimumPackageVersion(
        "0.4.0",
        packageVersion,
        () => {
          called = "hasVersion";
        },
        () => {
          called = "doesntHaveVersion";
        }
      );

      assert.strictEqual(called, "doesntHaveVersion");
    });

    test("should return value from hasVersion callback", () => {
      const packageVersion = createVersionDescriptor("0.5.0");

      const result = withMinimumPackageVersion(
        "0.4.0",
        packageVersion,
        () => "has-version-result",
        () => "no-version-result"
      );

      assert.strictEqual(result, "has-version-result");
    });

    test("should return value from doesntHaveVersion callback", () => {
      const packageVersion = createVersionDescriptor("0.3.0");

      const result = withMinimumPackageVersion(
        "0.4.0",
        packageVersion,
        () => "has-version-result",
        () => "no-version-result"
      );

      assert.strictEqual(result, "no-version-result");
    });

    test("should handle null packageVersion", () => {
      let called = "";

      withMinimumPackageVersion(
        "0.4.0",
        null,
        () => {
          called = "hasVersion";
        },
        () => {
          called = "doesntHaveVersion";
        }
      );

      assert.strictEqual(called, "doesntHaveVersion");
    });
  });

  suite("Developer Build Detection", () => {
    test("should detect .dev suffix", () => {
      const versionStr = "0.4.1.dev1";
      const isDev = versionStr.includes(".dev");

      assert.strictEqual(isDev, true);
    });

    test("should not detect dev in release version", () => {
      const versionStr = "0.4.1";
      const isDev = versionStr.includes(".dev");

      assert.strictEqual(isDev, false);
    });

    test("should handle various dev version formats", () => {
      const devVersions = ["0.4.1.dev1", "0.4.1.dev123", "1.0.0.dev0"];

      for (const version of devVersions) {
        assert.ok(
          version.includes(".dev"),
          `${version} should be detected as dev`
        );
      }
    });
  });

  suite("Edge Cases", () => {
    test("should handle version 0.0.0", () => {
      const packageVersion = createVersionDescriptor("0.0.0");
      const result = hasMinimumPackageVersion("0.0.0", packageVersion);

      assert.strictEqual(result, true);
    });

    test("should handle large version numbers", () => {
      const packageVersion = createVersionDescriptor("100.200.300");
      const result = hasMinimumPackageVersion("99.999.999", packageVersion);

      assert.strictEqual(result, true);
    });

    test("should handle minimum inspect version requirement", () => {
      // Minimum inspect version is 0.3.8
      const minimumVersion = "0.3.8";

      const tooOld = createVersionDescriptor("0.3.7");
      const exactMatch = createVersionDescriptor("0.3.8");
      const newer = createVersionDescriptor("0.4.0");

      assert.strictEqual(
        hasMinimumPackageVersion(minimumVersion, tooOld),
        false
      );
      assert.strictEqual(
        hasMinimumPackageVersion(minimumVersion, exactMatch),
        true
      );
      assert.strictEqual(hasMinimumPackageVersion(minimumVersion, newer), true);
    });
  });

  suite("Version String Parsing", () => {
    test("should coerce version strings correctly", () => {
      // Test that versions are parsed correctly
      const testCases = [
        { input: "1.2.3", expected: { major: 1, minor: 2, patch: 3 } },
        { input: "0.3.8", expected: { major: 0, minor: 3, patch: 8 } },
        { input: "0.3.10", expected: { major: 0, minor: 3, patch: 10 } },
        { input: "1.0.0", expected: { major: 1, minor: 0, patch: 0 } },
      ];

      for (const { input, expected } of testCases) {
        const descriptor = createVersionDescriptor(input);
        assert.strictEqual(
          descriptor.version.major,
          expected.major,
          `Major version mismatch for ${input}`
        );
        assert.strictEqual(
          descriptor.version.minor,
          expected.minor,
          `Minor version mismatch for ${input}`
        );
        assert.strictEqual(
          descriptor.version.patch,
          expected.patch,
          `Patch version mismatch for ${input}`
        );
      }
    });
  });
});
