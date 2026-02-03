import { readFileSync } from "fs";
import { join } from "path";

import { Disposable, ExtensionContext, extensions, Uri } from "vscode";

import { log } from "../../core/log";

// Magic comment pattern for detecting scan job config files
const SCANJOB_MAGIC_PATTERN = /^#\s*scanjob\s*$/m;

// Auto-detection patterns: both must be present for ScanJobConfig
const TRANSCRIPTS_PATTERN = /^transcripts:\s/m;
const SCANNERS_PATTERN = /^scanners:\s/m;

// Schema identifier constants
const SCHEMA_ID = "scout-yaml-schemas";
const PROJECT_SCHEMA_URI = `${SCHEMA_ID}:///project`;
const SCANJOB_SCHEMA_URI = `${SCHEMA_ID}:///scanjob`;

interface YamlExtensionApi {
  registerContributor(
    schemaId: string,
    requestUri: (resource: string) => string | undefined,
    requestContent: (uri: string) => string | undefined
  ): void;
}

/**
 * Activates YAML schema support for Scout configuration files.
 *
 * Provides:
 * - Schema validation and completion for scout.yaml (project config)
 * - Schema validation and completion for scan job config files
 *   (detected via magic comment or presence of transcripts+scanners fields)
 */
export async function activateYamlSchemaProvider(
  context: ExtensionContext
): Promise<Disposable | undefined> {
  const yamlExtension = extensions.getExtension("redhat.vscode-yaml");

  if (!yamlExtension) {
    log.info("YAML extension not found, skipping schema registration");
    return undefined;
  }

  try {
    // Activate the YAML extension if needed
    if (!yamlExtension.isActive) {
      await yamlExtension.activate();
    }

    const yamlApi = yamlExtension.exports as YamlExtensionApi;

    if (!yamlApi?.registerContributor) {
      log.warn("YAML extension API does not support registerContributor");
      return undefined;
    }

    // Load schemas from bundled assets
    const schemasDir = join(context.extensionPath, "assets", "schemas");

    const schemas: Record<string, string> = {};
    try {
      schemas.project = readFileSync(
        join(schemasDir, "project.schema.json"),
        "utf-8"
      );
      schemas.scanjob = readFileSync(
        join(schemasDir, "scanjob.schema.json"),
        "utf-8"
      );
    } catch (error) {
      log.error(`Failed to load YAML schemas: ${String(error)}`);
      return undefined;
    }

    // Cache for file content checks
    const contentCache = new Map<
      string,
      { content: string; timestamp: number }
    >();
    const CACHE_TTL_MS = 5000; // 5 second cache

    /**
     * Request schema URI callback - determines which schema to use for a file
     */
    const onRequestSchemaURI = (resource: string): string | undefined => {
      try {
        const uri = Uri.parse(resource);
        const fileName = uri.path.split("/").pop() || "";

        // Check for scout.yaml (project config)
        if (fileName === "scout.yaml") {
          log.info(
            `YAML schema: matched scout.yaml, returning ${PROJECT_SCHEMA_URI}`
          );
          return PROJECT_SCHEMA_URI;
        }

        // Check for scan job config files
        if (fileName.endsWith(".yaml") || fileName.endsWith(".yml")) {
          if (isScanJobConfig(uri, contentCache, CACHE_TTL_MS)) {
            return SCANJOB_SCHEMA_URI;
          }
        }

        return undefined;
      } catch (error) {
        log.error(`Error in onRequestSchemaURI: ${String(error)}`);
        return undefined;
      }
    };

    /**
     * Request schema content callback - returns the schema JSON
     */
    const onRequestSchemaContent = (schemaUri: string): string | undefined => {
      try {
        log.info(
          `YAML schema: onRequestSchemaContent called with ${schemaUri}`
        );
        const uri = Uri.parse(schemaUri);

        if (uri.scheme !== SCHEMA_ID) {
          log.info(
            `YAML schema: scheme ${uri.scheme} doesn't match ${SCHEMA_ID}`
          );
          return undefined;
        }

        switch (uri.path) {
          case "/project":
            log.info(
              `YAML schema: returning project schema (${schemas.project.length} bytes)`
            );
            return schemas.project;
          case "/scanjob":
            log.info(
              `YAML schema: returning scanjob schema (${schemas.scanjob.length} bytes)`
            );
            return schemas.scanjob;
          default:
            log.info(`YAML schema: unknown path ${uri.path}`);
            return undefined;
        }
      } catch (error) {
        log.error(`Error in onRequestSchemaContent: ${String(error)}`);
        return undefined;
      }
    };

    // Register the schema contributor
    yamlApi.registerContributor(
      SCHEMA_ID,
      onRequestSchemaURI,
      onRequestSchemaContent
    );

    log.info("Registered YAML schema contributor for Scout configs");

    // Return a disposable that clears the cache
    return {
      dispose: () => {
        contentCache.clear();
      },
    };
  } catch (error) {
    log.error(`Failed to activate YAML schema provider: ${String(error)}`);
    return undefined;
  }
}

/**
 * Check if a file is a ScanJobConfig based on content.
 *
 * Detection methods:
 * 1. Magic comment: `# scanjob` in the first 10 lines
 * 2. Auto-detection: Both `transcripts:` and `scanners:` as top-level fields
 */
function isScanJobConfig(
  uri: Uri,
  cache: Map<string, { content: string; timestamp: number }>,
  cacheTtlMs: number
): boolean {
  try {
    const now = Date.now();
    const cacheKey = uri.toString();
    const cached = cache.get(cacheKey);

    let content: string;
    if (cached && now - cached.timestamp < cacheTtlMs) {
      content = cached.content;
    } else {
      // Read the file content
      const fullContent = readFileSync(uri.fsPath, "utf-8");
      // Cache only first portion for performance (enough for detection)
      content = fullContent.slice(0, 2000);
      cache.set(cacheKey, { content, timestamp: now });
    }

    // Check for magic comment in first 10 lines
    const firstLines = content.split("\n").slice(0, 10).join("\n");
    if (SCANJOB_MAGIC_PATTERN.test(firstLines)) {
      return true;
    }

    // Auto-detect: check for both transcripts and scanners top-level fields
    if (TRANSCRIPTS_PATTERN.test(content) && SCANNERS_PATTERN.test(content)) {
      return true;
    }

    return false;
  } catch {
    // File may not exist or be readable
    return false;
  }
}
