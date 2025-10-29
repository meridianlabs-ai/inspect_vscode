import { coerce } from "semver";
import { VersionDescriptor } from "./props";

export function withMinimumPackageVersion<T>(
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

export function hasMinimumPackageVersion(
  version: string,
  packageVersion: VersionDescriptor | null,
  strictDevCheck = false
): boolean {
  if (packageVersion?.isDeveloperBuild && strictDevCheck) {
    // Since this is strictly being checked, require that the version is actually greater
    // than the minimum version (we declare the minimum version based upon the pypi version, but the
    // dev version is often one patch level great since it has already been tagged with the pypi version
    // and incremented it)
    const required = coerce(version);
    const installed = packageVersion.version;
    return (
      installed.major >= (required?.major || 0) &&
      installed.minor >= (required?.minor || 0) &&
      installed.patch > (required?.patch || 0)
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
