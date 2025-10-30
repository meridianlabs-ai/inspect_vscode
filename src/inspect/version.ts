import { inspectVersionDescriptor } from "./props";
import {
  hasMinimumPackageVersion,
  withMinimumPackageVersion,
} from "../core/package/version";

export function withMinimumInspectVersion(
  version: string,
  hasVersion: () => void,
  doesntHaveVersion: () => void
): void;
export function withMinimumInspectVersion<T>(
  version: string,
  hasVersion: () => T,
  doesntHaveVersion: () => T
): T;

export function withMinimumInspectVersion<T>(
  version: string,
  hasVersion: () => T,
  doesntHaveVersion: () => T
): T | void {
  return withMinimumPackageVersion(
    version,
    inspectVersionDescriptor(),
    hasVersion,
    doesntHaveVersion
  );
}

export function hasMinimumInspectVersion(
  version: string,
  strictDevCheck = false
): boolean {
  return hasMinimumPackageVersion(
    version,
    inspectVersionDescriptor(),
    strictDevCheck
  );
}
