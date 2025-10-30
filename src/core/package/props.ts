import { SemVer, coerce } from "semver";

import { log } from "../log";
import { pythonBinaryPath, pythonInterpreter } from "../python";
import { AbsolutePath, toAbsolutePath } from "../path";
import { Disposable } from "vscode";
import { runProcess } from "../process";
import { existsSync } from "fs";

export interface VersionDescriptor {
  raw: string;
  version: SemVer;
  isDeveloperBuild: boolean;
}

// we cache the results of these functions so long as
// they (a) return success, and (b) the active python
// interpreter hasn't been changed
export class PackagePropsCache implements Disposable {
  private readonly eventHandle_: Disposable;

  constructor(
    private package_: string,
    private pacakge_bin_: string,
    private binPath_: AbsolutePath | null,
    private version_: VersionDescriptor | null,
    private viewPath_: AbsolutePath | null
  ) {
    this.eventHandle_ = pythonInterpreter().onDidChange(() => {
      log.info(`Resetting ${this.package_} props to null`);
      this.binPath_ = null;
      this.version_ = null;
      this.viewPath_ = null;
    });
  }

  get pkg(): string {
    return this.package_;
  }

  get pkg_bin(): string {
    return this.pacakge_bin_;
  }

  get binPath(): AbsolutePath | null {
    return this.binPath_;
  }

  setBinPath(binPath: AbsolutePath) {
    log.info(`${this.package_} bin path: ${binPath.path}`);
    this.binPath_ = binPath;
  }

  get version(): VersionDescriptor | null {
    return this.version_;
  }

  setVersion(version: VersionDescriptor) {
    log.info(`${this.package_} version: ${version.version.toString()}`);
    this.version_ = version;
  }

  get viewPath(): AbsolutePath | null {
    return this.viewPath_;
  }

  setViewPath(path: AbsolutePath) {
    log.info(`${this.package_} view path: ${path.path}`);
    this.viewPath_ = path;
  }

  dispose() {
    this.eventHandle_.dispose();
  }
}

export function initPackageProps(
  pkg: string,
  pkg_binary: string
): PackagePropsCache {
  return new PackagePropsCache(pkg, pkg_binary, null, null, null);
}

export function packageVersionDescriptor(
  packagePropsCache: PackagePropsCache
): VersionDescriptor | null {
  if (packagePropsCache.version) {
    return packagePropsCache.version;
  } else {
    const packageBin = packageBinPath(packagePropsCache);
    if (packageBin) {
      try {
        const versionJson = runProcess(packageBin, [
          "info",
          "version",
          "--json",
        ]);
        const version = JSON.parse(versionJson) as {
          version: string;
          path: string;
        };

        const parsedVersion = coerce(version.version);
        if (parsedVersion) {
          const isDeveloperVersion = version.version.indexOf(".dev") > -1;
          const packageVersion = {
            raw: version.version,
            version: parsedVersion,
            isDeveloperBuild: isDeveloperVersion,
          };
          packagePropsCache.setVersion(packageVersion);
          return packageVersion;
        } else {
          return null;
        }
      } catch (error) {
        log.error(`Error attempting to read ${packagePropsCache.pkg} version.`);
        log.error(error instanceof Error ? error : String(error));
        return null;
      }
    } else {
      return null;
    }
  }
}

// path to package view www assets
export function packageViewPath(
  packagePropsCache: PackagePropsCache
): AbsolutePath | null {
  if (packagePropsCache.viewPath) {
    return packagePropsCache.viewPath;
  } else {
    const packageBin = packageBinPath(packagePropsCache);
    if (packageBin) {
      try {
        const versionJson = runProcess(packageBin, [
          "info",
          "version",
          "--json",
        ]);
        const version = JSON.parse(versionJson) as {
          version: string;
          path: string;
        };
        let viewPath = toAbsolutePath(version.path)
          .child("_view")
          .child("www")
          .child("dist");

        if (!existsSync(viewPath.path)) {
          // The dist folder is only available on newer versions, this is for
          // backwards compatibility only
          viewPath = toAbsolutePath(version.path).child("_view").child("www");
        }
        packagePropsCache.setViewPath(viewPath);
        return viewPath;
      } catch (error) {
        log.error(
          `Error attempting to read ${packagePropsCache.pkg} view path.`
        );
        log.error(error instanceof Error ? error : String(error));
        return null;
      }
    } else {
      return null;
    }
  }
}

export function packageBinPath(
  packagePropsCache: PackagePropsCache
): AbsolutePath | null {
  if (packagePropsCache.binPath) {
    return packagePropsCache.binPath;
  } else {
    const interpreter = pythonInterpreter();
    if (interpreter.available) {
      try {
        const binPath = pythonBinaryPath(
          interpreter,
          packageFileName(packagePropsCache.pkg_bin)
        );
        if (binPath) {
          packagePropsCache.setBinPath(binPath);
        }
        return binPath;
      } catch (error) {
        log.error(`Error attempting to read ${packagePropsCache.pkg} version.`);
        log.error(error instanceof Error ? error : String(error));
        return null;
      }
    } else {
      return null;
    }
  }
}

function packageFileName(pkg_bin: string): string {
  switch (process.platform) {
    case "darwin":
      return pkg_bin;
    case "win32":
      return pkg_bin + ".exe";
    case "linux":
    default:
      return pkg_bin;
  }
}
