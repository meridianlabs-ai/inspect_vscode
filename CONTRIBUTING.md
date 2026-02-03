# Contributing to Inspect AI for VS Code

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- [Yarn](https://yarnpkg.com/) package manager
- [VS Code](https://code.visualstudio.com/) >= 1.85.0
- Python with [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) and [Scout](https://github.com/UKGovernmentBEIS/inspect_scout) installed

## Python Package Dependencies

The extension uses the **active Python environment's versions** of `inspect_ai` and `inspect_scout`. We recommend installing both packages:

```bash
pip install inspect_ai inspect_scout
```

The Inspect Log Viewer and Scout Viewer web applications displayed within the extension are **provided by these packages directly**—they are not part of this repository. When you run the extension, it launches these viewers from the installed packages.

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/meridianlabs-ai/inspect_vscode.git
   cd inspect_vscode
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```

3. Build the extension:
   ```bash
   yarn compile
   ```

## Development Workflow

### Available Commands

| Command | Description |
|---------|-------------|
| `yarn compile` | Build the extension with webpack |
| `yarn watch` | Build and watch for changes |
| `yarn test` | Run tests (compiles first) |
| `yarn lint` | Run ESLint |
| `yarn lint:fix` | Run ESLint with auto-fix |
| `yarn prettier` | Format code with Prettier |
| `yarn check-all` | Run lint + prettier + test (CI equivalent) |
| `yarn package` | Create production VSIX package |

### Running the Extension

1. Open this repository in VS Code
2. Press `F5` to launch a new VS Code window with the extension loaded
3. Make changes to the source code
4. Use `Cmd+Shift+F5` (Mac) or `Ctrl+Shift+F5` (Windows/Linux) to reload the extension window

For continuous development, run `yarn watch` in a terminal to automatically rebuild on file changes.

### Running Tests

```bash
yarn test
```

Tests run in a headless VS Code environment using `@vscode/test-electron`.

### Debugging

Two launch configurations are available in `.vscode/launch.json`:

- **Run Extension** - Launch the extension in debug mode
- **Extension Tests** - Run tests with debugging

Set breakpoints in the TypeScript source files and use F5 to start debugging.

## Project Structure

```
src/
├── extension.ts          # Entry point
├── core/                 # Shared utilities
│   ├── python/          # Python interpreter integration
│   ├── package/         # Package management
│   └── vscode/          # VS Code API wrappers
├── providers/           # VS Code feature implementations
│   ├── activity-bar/    # Main sidebar UI (webview)
│   ├── logview/         # Log viewer
│   ├── codelens/        # CodeLens providers
│   └── ...
├── inspect/             # Inspect AI integration
└── scout/               # Scout integration
```

## Architecture Notes

- **Activation**: Features use `activate*()` functions returning `[commands, manager]` tuples
- **Disposables**: Always register with `context.subscriptions.push()` for cleanup
- **Webviews**: Have separate webpack configs, output to `out/` directory
- **Unused params**: Prefix with underscore (`_param`) to satisfy TypeScript strict checks

## Code Style

- TypeScript with strict mode enabled
- ESLint + Prettier for formatting
- Run `yarn check-all` before submitting PRs

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Please format your commit messages as:

```
<type>: <description>

[optional body]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, whitespace) |
| `refactor` | Code changes that neither fix bugs nor add features |
| `perf` | Performance improvements |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks, dependency updates |

### Examples

```
feat: Add task filtering to activity bar
fix: Resolve log viewer crash on large files
docs: Update installation instructions
refactor: Extract webview messaging into separate module
```

## Building for Release

```bash
yarn package
```

This creates a `.vsix` file that can be installed locally or published to the marketplace.

## Troubleshooting

### Extension doesn't activate
- Ensure you have a workspace folder open (not just a file)
- Check the Output panel (View > Output) and select "Inspect AI" from the dropdown

### Python/Inspect issues
- The extension requires Inspect AI >= 0.3.8
- Verify your active Python environment has both packages installed:
  ```bash
  pip show inspect_ai inspect_scout
  ```
- The extension uses whichever Python interpreter is selected in VS Code

### Viewer not loading
- The log viewer and scan viewer are served by the installed Python packages
- Ensure `inspect_ai` and `inspect_scout` are properly installed in your active environment

## Working on the Viewer UIs

The Inspect and Scout viewer web applications are maintained in their respective repositories. If you want to modify these viewers:

1. Clone and install an editable version of the relevant package:
   - [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai)
   - [Scout](https://github.com/UKGovernmentBEIS/inspect_scout)

2. From within the package directory, run the view development commands

See each repository's documentation for details.
