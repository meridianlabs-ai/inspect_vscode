import { scoutVersionDescriptor } from "./props";
import {
  hasMinimumPackageVersion,
  withMinimumPackageVersion,
} from "../core/package/version";

export function withMinimumScoutVersion(
  version: string,
  hasVersion: () => void,
  doesntHaveVersion: () => void
): void;
export function withMinimumScoutVersion<T>(
  version: string,
  hasVersion: () => T,
  doesntHaveVersion: () => T
): T;

export function withMinimumScoutVersion<T>(
  version: string,
  hasVersion: () => T,
  doesntHaveVersion: () => T
): T | void {
  return withMinimumPackageVersion(
    version,
    scoutVersionDescriptor(),
    hasVersion,
    doesntHaveVersion
  );
}

export function hasMinimumScoutVersion(
  version: string,
  strictDevCheck = false
): boolean {
  return hasMinimumPackageVersion(
    version,
    scoutVersionDescriptor(),
    strictDevCheck
  );
}
