import { AbsolutePath, toAbsolutePath } from "../core/path";
import { Disposable } from "vscode";
import {
  initPackageProps,
  packageBinPath,
  PackagePropsCache,
  packageVersionDescriptor,
  packageViewPath,
  VersionDescriptor,
} from "../core/package/props";
import { userDataDir, userRuntimeDir } from "../core/appdirs";
import { join } from "path";

const kPythonPackageName = "inspect_scout";

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

export function scoutLastScanPaths(): AbsolutePath[] {
  return [userRuntimeDir(kPythonPackageName), userDataDir(kPythonPackageName)]
    .map(dir => join(dir, "view", "last-scan"))
    .map(toAbsolutePath);
}
