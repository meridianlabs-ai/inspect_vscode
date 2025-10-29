import { AbsolutePath } from "../core/path";
import { Disposable } from "vscode";
import {
  initPackageProps,
  packageBinPath,
  PackagePropsCache,
  packageVersionDescriptor,
  packageViewPath,
  VersionDescriptor,
} from "../core/package/props";

export const kPythonPackageName = "inspect_ai";

let scoutPropsCache_: PackagePropsCache;

export function initScoutProps(): Disposable {
  scoutPropsCache_ = initPackageProps("inspect_scout", "scout");
  return scoutPropsCache_;
}

export function scoutVersionDescriptor(): VersionDescriptor | null {
  return packageVersionDescriptor(scoutPropsCache_);
}

export function scoutViewPath(): AbsolutePath | null {
  return packageViewPath(scoutPropsCache_);
}

export function scoutBinPath(): AbsolutePath | null {
  return packageBinPath(scoutPropsCache_);
}
