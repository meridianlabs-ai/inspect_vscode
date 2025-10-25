import { ExtensionContext } from "vscode";
import { inspectBinPath } from "../../inspect/props";
import { AbsolutePath } from "../../core/path";
import { delimiter } from "path";
import { PackageChangedEvent, PackageManager } from "../../core/package/manager";

// Activates the provider which tracks the availability of Inspect
export function activateInspectManager(context: ExtensionContext) {
  const inspectManager = new PackageManager(context, inspectBinPath);

  // Initialize the terminal with the inspect bin path
  // on the path (if needed)
  const terminalEnv = terminalEnvironment(context);
  context.subscriptions.push(
    inspectManager.onPackageChanged((e: PackageChangedEvent) => {
      terminalEnv.update(e.binPath);
    })
  );
  terminalEnv.update(inspectBinPath());

  return inspectManager;
}

// Configures the terminal environment to support inspect. We do this
// to ensure the the 'inspect' command will work from within the
// terminal (especially in cases where the global interpreter is being used)
const terminalEnvironment = (context: ExtensionContext) => {
  const filter = (binPath: AbsolutePath | null) => {
    switch (process.platform) {
      case "win32": {
        const localPath = process.env["LocalAppData"];
        if (localPath) {
          return binPath?.path.startsWith(localPath);
        }
        return false;
      }
      case "linux":
        return binPath && binPath.path.includes(".local/bin");
      default:
        return false;
    }
  };

  return {
    update: (binPath: AbsolutePath | null) => {
      // The path info
      const env = context.environmentVariableCollection;
      env.delete("PATH");
      // Actually update the path
      const binDir = binPath?.dirname();
      if (binDir && filter(binPath)) {
        env.append("PATH", `${delimiter}${binDir.path}`);
      }
    },
  };
};
