import Ajv from "ajv";

import projectSchema from "../../../assets/schemas/project.schema.json";

const validate = new Ajv({ strict: false }).compile({
  ...projectSchema,
  additionalProperties: false,
  properties: {
    ...projectSchema.properties,
    results_buffer: { type: ["integer", "null"] },
  },
});

export interface ScanConfigScope {
  scans: (location: string) => boolean;
  transcripts: (location: string) => boolean;
  project: (location: string) => boolean;
  modelEndpoint?: (location: string) => boolean;
}

/** The startscan and project/config bodies both use Scout's ScanJobConfig.
 * Keep this inventory alongside its schema: string model_args and validation
 * entries are files too, not just transcripts/scans and ScannerSpec.file.
 */
export function assertScanConfigInScope(
  body: string | undefined,
  scope: ScanConfigScope
): void {
  if (body === undefined) throw new Error("Missing scan configuration");
  const config: unknown = JSON.parse(body);
  if (!validate(config)) throw new Error("Invalid scan configuration");
  const value = config as Record<string, unknown>;
  const check = (location: unknown, allowed: (value: string) => boolean) => {
    if (location === undefined || location === null) return;
    if (typeof location !== "string" || !allowed(location)) {
      throw new Error(
        "Scan configuration location is outside the scope of this view"
      );
    }
  };
  check(value.transcripts, scope.transcripts);
  check(value.scans, scope.scans);
  check(value.results, scope.scans);
  check(value.model_base_url, scope.modelEndpoint ?? (() => false));
  for (const role of Object.values(value.model_roles ?? {})) {
    if (role && typeof role === "object") {
      check(
        (role as Record<string, unknown>).base_url,
        scope.modelEndpoint ?? (() => false)
      );
    }
  }
  if (value.scans !== undefined && value.results !== undefined) {
    throw new Error("Use scans or results, not both");
  }
  if (typeof value.model_args === "string")
    check(value.model_args, scope.project);
  for (const scanner of Object.values(value.scanners ?? {})) {
    check((scanner as Record<string, unknown>).file, scope.project);
  }
  for (const validation of Object.values(value.validation ?? {})) {
    if (typeof validation === "string") check(validation, scope.project);
  }
}
