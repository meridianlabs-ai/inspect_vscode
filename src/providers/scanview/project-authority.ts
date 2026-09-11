import path from "path";

import { FileType, Uri, workspace } from "vscode";

import type { ScoutProjectConfig } from "../scout/scout-project";

export async function defaultProjectTranscripts(
  projectRoot: Uri | undefined,
  logDir: Uri
): Promise<string> {
  const candidate = projectRoot && Uri.joinPath(projectRoot, "transcripts");
  if (candidate) {
    try {
      if ((await workspace.fs.stat(candidate)).type === FileType.Directory)
        return candidate.toString();
    } catch {
      /* Missing directory; Scout falls back to Inspect logs. */
    }
  }
  return logDir.toString();
}

/** Capture host-loaded configuration once. A subsequent webview project edit
 * must not become a new authorization, including when another panel opens.
 */
export function captureProjectAuthority(
  config: ScoutProjectConfig,
  resolve: (location: string) => Uri
) {
  const roots = (location: unknown): Uri[] => {
    if (typeof location !== "string" || !location) return [];
    const root = resolve(location);
    const normalized = path.posix.normalize(root.path.replace(/\\/g, "/"));
    // Filesystem/drive roots are too broad. A configured remote bucket remains
    // bounded by its scheme and authority, including the spelling without /.
    if (
      root.scheme === "file" &&
      (normalized === "/" || /^\/[a-zA-Z]:\/?$/.test(normalized))
    )
      return [];
    return [root.path ? root : root.with({ path: "/" })];
  };
  const modelEndpoints: string[] = [];
  if (typeof config.model_base_url === "string")
    modelEndpoints.push(config.model_base_url);
  for (const role of Object.values(config.model_roles ?? {})) {
    if (
      role &&
      typeof role === "object" &&
      "base_url" in role &&
      typeof role.base_url === "string"
    )
      modelEndpoints.push(role.base_url);
  }
  return {
    transcripts: roots(config.transcripts),
    scans: roots("scans" in config ? config.scans : config.results),
    modelEndpoints,
  };
}
