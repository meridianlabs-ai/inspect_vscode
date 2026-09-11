import path from "path";

import { Uri } from "vscode";

import type { ScoutProjectConfig } from "../scout/scout-project";

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
    // Do not interpret a filesystem, drive or entire bucket as project scope.
    return normalized === "/" || /^\/[a-zA-Z]:\/?$/.test(normalized)
      ? []
      : [root];
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
    scans: roots(config.scans ?? config.results),
    modelEndpoints,
  };
}
