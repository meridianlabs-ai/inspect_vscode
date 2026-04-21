# Inspect AI for VS Code

VS Code extension for the [Inspect](https://inspect.aisi.org.uk/) framework for large language model evaluations. This extension provides support for developing evaluations using Inspect, including:

- Integrated viewer for evaluation log files
- Panel to browse, run, and debug tasks in the workspace
- Panel for editing Inspect `.env` file
- Panel for configuring task CLI options and args
- Commands and key-bindings for running and debugging tasks

## Prerequisites

- [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) >= 0.3.8 installed in your active Python environment
- Scout features (see below) only activate if [Inspect Scout](https://github.com/UKGovernmentBEIS/inspect_scout) is also installed

## Log Viewer

The `inspect view` command is used to automatically display the log for tasks executed within the workspace (this behavior can be controlled with an option).

## Task Navigation

The Tasks panel displays a listing of all the Inspect tasks within your workspace. Selecting the source file or task within the listing will open the task source code in the source editor (or Notebook viewer). You can display a tree of tasks including folders and hierarchy or a flat list of tasks sorted alphabetically.

## Configuration Panel

Use the Configuration (.env) panel to edit common settings in your `.env` file including the model provider and name, and the log directory and level.

## Task Panel

Use the Task panel to edit CLI options for a task, set task args, and run or debug a task. Values will be saved for each task and used whenever the task is run or debugged from within the Inspect VS Code extension.

## Running and Debugging

The Inspect VS Code extension includes commands and keyboard shortcuts for running or debugging tasks. After the task has been completed, `inspect view` is used behind the scenes to provide a results pane within VS Code alongside your source code.

Use the run or debug commands to execute the current task. You can alternatively use the <kbd>Ctrl+Shift+U</kbd> keyboard shortcut to run a task, or the <kbd>Ctrl+Shift+T</kbd> keyboard shortcut to debug a task.

> Note that on the Mac you should use `Cmd` rather than `Ctrl` as the prefix for all Inspect keyboard shortcuts.

## Scout

When [Inspect Scout](https://github.com/UKGovernmentBEIS/inspect_scout) is installed, the extension provides a dedicated Scout activity bar with additional features:

- **Scan Viewer** — Custom editor for browsing and inspecting scan results
- **Scan Listing** — Tree view of all available scans with refresh, delete, and reveal-in-explorer actions
- **Run & Debug Scans** — Execute or debug Scout scans directly from VS Code
- **Scout View** — Tabbed interface for navigating project configuration, transcripts, scans, and validations
- **Project Configuration** — Detects and validates `scout.yml`/`scout.yaml` files in your workspace
- **Scan Notifications** — Configurable notifications when scans complete, with a quick link to view results

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.
