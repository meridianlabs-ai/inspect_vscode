import * as assert from "assert";

import { coerce } from "semver";

import { VersionDescriptor } from "../core/package/props";

/** An installed package version, parsed the way packageVersionDescriptor
 *  parses `<package> info version`. */
export const installed = (raw: string): VersionDescriptor => {
  const version = coerce(raw);
  assert.ok(version, raw);
  return { raw, version, isDeveloperBuild: raw.includes(".dev") };
};
