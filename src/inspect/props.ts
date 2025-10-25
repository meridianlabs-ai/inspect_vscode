
import { AbsolutePath, toAbsolutePath } from "../core/path";
import { Disposable } from "vscode";
import { join } from "path";
import { userDataDir, userRuntimeDir } from "../core/appdirs";
import { kInspectChangeEvalSignalVersion } from "../providers/inspect/inspect-constants";
import { initPackageProps, packageBinPath, PackagePropsCache, packageVersionDescriptor, packageViewPath, VersionDescriptor } from "../core/package/props";

export const kPythonPackageName = "inspect_ai";

let inspectPropsCache_: PackagePropsCache;


export function initInspectProps(): Disposable {
  inspectPropsCache_ = initPackageProps("inspect_ai", "inspect");
  return inspectPropsCache_;
}


export function inspectVersionDescriptor(): VersionDescriptor | null {
  return packageVersionDescriptor(inspectPropsCache_)
}


// path to inspect view www assets
export function inspectViewPath(): AbsolutePath | null {
  return packageViewPath(inspectPropsCache_)
}

export function inspectBinPath(): AbsolutePath | null {
  return packageBinPath(inspectPropsCache_)
}

export function inspectLastEvalPaths(): AbsolutePath[] {
  const descriptor = inspectVersionDescriptor();
  const fileName =
    descriptor &&
    descriptor.version.compare(kInspectChangeEvalSignalVersion) < 0
      ? "last-eval"
      : "last-eval-result";

  return [userRuntimeDir(kPythonPackageName), userDataDir(kPythonPackageName)]
    .map(dir => join(dir, "view", fileName))
    .map(toAbsolutePath);
}

