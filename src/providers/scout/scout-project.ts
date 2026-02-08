import {
  Disposable,
  Event,
  EventEmitter,
  ExtensionContext,
  FileSystemWatcher,
  RelativePattern,
  Uri,
  workspace,
} from "vscode";
import { parse } from "yaml";
import Ajv, { ValidateFunction } from "ajv";
import { throttle } from "lodash";

import { Command } from "../../core/command";
import { log } from "../../core/log";
import { activeWorkspacePath } from "../../core/path";

// Import the JSON schema for validation
import projectSchema from "../../../assets/schemas/project.schema.json";

/**
 * Scout project configuration interface.
 * Represents the parsed content of scout.yml/scout.yaml files.
 */
export interface ScoutProjectConfig {
  name: string;
  results: string; // scans output directory (default: "./scans")
  transcripts: string | string[]; // transcript sources (default: "./logs")
  model?: string | null;
  model_args?: Record<string, unknown> | string | null;
  model_base_url?: string | null;
  model_roles?: Record<string, unknown> | null;
  log_level?: string | null;
  limit?: number | null;
  max_transcripts?: number | null;
  max_processes?: number | null;
  shuffle?: boolean | number | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
  scanners?: unknown[] | Record<string, unknown> | null;
  validation?: Record<string, unknown> | null;
  worklist?: unknown[] | null;
  generate_config?: Record<string, unknown> | null;
}

/**
 * Event fired when the scout project configuration changes.
 */
export interface ScoutProjectChangedEvent {
  config: ScoutProjectConfig;
  filePath?: string; // undefined when using defaults
  validationErrors?: string[]; // present if schema validation failed
}

/**
 * Default configuration used when no scout.yml/yaml file exists.
 */
const DEFAULT_CONFIG: ScoutProjectConfig = {
  name: "job",
  results: "./scans",
  transcripts: "./logs",
};

/**
 * Manages the scout project configuration by watching for scout.yml/yaml files
 * in the workspace root and emitting events when the configuration changes.
 */
export class ScoutProjectManager implements Disposable {
  private config_: ScoutProjectConfig = { ...DEFAULT_CONFIG };
  private configFilePath_?: string;
  private watcher_: FileSystemWatcher;
  private validator_: ValidateFunction;

  private readonly onConfigChanged_ =
    new EventEmitter<ScoutProjectChangedEvent>();
  public readonly onConfigChanged: Event<ScoutProjectChangedEvent> =
    this.onConfigChanged_.event;

  constructor(private readonly context_: ExtensionContext) {
    // Initialize Ajv validator with the project schema
    const ajv = new Ajv({ allErrors: true, strict: false });
    this.validator_ = ajv.compile(projectSchema);

    // Create file system watcher for scout.yml/yaml in workspace root
    const workspacePath = activeWorkspacePath();
    const pattern = new RelativePattern(
      Uri.file(workspacePath.path),
      "scout.{yml,yaml}"
    );

    this.watcher_ = workspace.createFileSystemWatcher(
      pattern,
      false, // ignoreCreateEvents
      false, // ignoreChangeEvents
      false // ignoreDeleteEvents
    );

    // Throttle refresh to avoid excessive processing
    const throttledRefresh = throttle(
      async () => {
        await this.refresh();
      },
      500,
      { leading: true, trailing: true }
    );

    this.watcher_.onDidCreate(throttledRefresh);
    this.watcher_.onDidChange(throttledRefresh);
    this.watcher_.onDidDelete(throttledRefresh);

    // Push watcher to subscriptions for cleanup
    this.context_.subscriptions.push(this.watcher_);

    // Load initial configuration
    void this.refresh();
  }

  /**
   * Returns the current scout project configuration.
   */
  public getConfig(): ScoutProjectConfig {
    return this.config_;
  }

  /**
   * Returns the path to the config file, or undefined if using defaults.
   */
  public getConfigFilePath(): string | undefined {
    return this.configFilePath_;
  }

  /**
   * Refreshes the configuration by reading the scout.yml/yaml file.
   */
  public async refresh(): Promise<void> {
    const result = await this.loadConfig();
    this.config_ = result.config;
    this.configFilePath_ = result.filePath;

    this.onConfigChanged_.fire({
      config: this.config_,
      filePath: this.configFilePath_,
      validationErrors: result.validationErrors,
    });
  }

  /**
   * Loads the scout project configuration from the workspace.
   */
  private async loadConfig(): Promise<{
    config: ScoutProjectConfig;
    filePath?: string;
    validationErrors?: string[];
  }> {
    let workspacePath;
    try {
      workspacePath = activeWorkspacePath();
    } catch {
      // No workspace folder open, use defaults
      log.info("No workspace folder open, using default configuration");
      return {
        config: { ...DEFAULT_CONFIG },
      };
    }

    // Check for scout.yaml first, then scout.yml
    const configFiles = ["scout.yaml", "scout.yml"];

    for (const filename of configFiles) {
      const filePath = workspacePath.child(filename).path;
      const fileUri = Uri.file(filePath);

      try {
        const fileData = await workspace.fs.readFile(fileUri);
        const content = new TextDecoder().decode(fileData);
        const parsed = parse(content) as Record<string, unknown>;

        // Validate against schema
        let validationErrors: string[] | undefined;
        if (!this.validator_(parsed)) {
          validationErrors = this.validator_.errors?.map(
            e => `${e.instancePath || "/"} ${e.message}`
          );
          log.warn(
            `Scout project config validation errors: ${validationErrors?.join(", ")}`
          );
        }

        // Merge with defaults to ensure required fields exist
        const config: ScoutProjectConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          name: (parsed.name as string) || DEFAULT_CONFIG.name,
          results: (parsed.results as string) || DEFAULT_CONFIG.results,
          transcripts:
            (parsed.transcripts as string | string[]) ||
            DEFAULT_CONFIG.transcripts,
        };

        log.info(`Loaded scout project config from ${filename}`);

        return {
          config,
          filePath,
          validationErrors,
        };
      } catch (err) {
        // File doesn't exist, can't be read, or has invalid YAML
        // Check if it's a parse error vs file not found
        if (
          err instanceof Error &&
          err.message &&
          !err.message.includes("ENOENT")
        ) {
          log.warn(`Failed to parse ${filename}: ${err.message}`);
        }
        // Continue to next option
      }
    }

    // No config file found, use defaults
    log.info("No scout.yaml/yml found, using default configuration");
    return {
      config: { ...DEFAULT_CONFIG },
    };
  }

  /**
   * Disposes the manager and its resources.
   */
  dispose(): void {
    this.watcher_.dispose();
    this.onConfigChanged_.dispose();
  }
}

/**
 * Activates the scout project manager.
 * @param context The extension context
 * @returns A tuple of [commands, manager]
 */
export function activateScoutProject(
  context: ExtensionContext
): [Command[], ScoutProjectManager] {
  const manager = new ScoutProjectManager(context);
  context.subscriptions.push(manager);

  return [[], manager];
}
