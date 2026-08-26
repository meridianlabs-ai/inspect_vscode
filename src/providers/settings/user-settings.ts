import { ConfigurationTarget, workspace } from "vscode";

const kPackageIndexDepthsSetting = "packageIndexDepths";

export const initializeGlobalSettings = async () => {
  const pythonAnalysis = workspace.getConfiguration("python.analysis");

  // Read ONLY the user's global value, not the merged effective value. The
  // effective value returned by get() is overridden by workspace-scope
  // (repository .vscode/settings.json) entries, so writing it back to Global
  // would launder attacker-controlled workspace settings into the user's
  // persistent global settings across every future workspace.
  const globalDepths =
    pythonAnalysis.inspect<Array<{ name: string; depth: number }>>(
      kPackageIndexDepthsSetting
    )?.globalValue ?? [];

  try {
    // Merge only our own hardcoded entries into the global value.
    const pkgIndexDepths = [...globalDepths];
    let changed = false;
    kInspectPackageIndexDepth.forEach((pkgDep) => {
      if (!pkgIndexDepths.find((p) => pkgDep.name === p.name)) {
        pkgIndexDepths.push(pkgDep);
        changed = true;
      }
    });
    if (changed) {
      await pythonAnalysis.update(
        kPackageIndexDepthsSetting,
        pkgIndexDepths,
        ConfigurationTarget.Global
      );
    }
  } catch {
    // This can happen if the user disables the Pylance extension
    // in that case, since this is a Pylance setting, we're safe to just
    // ignore it
    //
    // Don't log since this is an allowed state (we don't require Pylance)
    // and continue for any exception since we shouldn't allow this setting
    // to block extension init
  }

  const config = workspace.getConfiguration("editor", { languageId: "json" });
  await config.update("wordWrap", "on", true);
};

const kInspectPackageIndexDepth = [
  {
    name: "inspect_ai",
    depth: 2,
  },
  {
    name: "inspect_viz",
    depth: 2,
  },
  {
    name: "inspect_scout",
    depth: 2,
  },
  {
    name: "inspect_flow",
    depth: 2,
  },
  {
    name: "petri",
    depth: 2,
  },
];
