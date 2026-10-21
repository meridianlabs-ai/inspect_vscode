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
  packageVersion: VersionDescriptor | null
): boolean {
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
