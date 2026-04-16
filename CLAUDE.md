# CLAUDE.md

VS Code extension for the Inspect AI evaluation framework. Provides log viewing, task running/debugging, and Scout integration.

## Commands

```bash
pnpm install          # install dependencies
pnpm build            # build with webpack
pnpm dev              # build and watch
pnpm test             # run tests (runs build first)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm lint:fix         # eslint with auto-fix
pnpm format           # format code
pnpm format:check     # check formatting without writing
pnpm check-all        # lint + format:check + typecheck + test (CI equivalent)
```

## Key Patterns

- **Activation**: Features use `activate*()` functions returning `[commands, manager]` tuples
- **Disposables**: Always use `context.subscriptions.push()` for cleanup
- **Webviews**: Have separate webpack configs, output to `out/` directory (excluded from eslint)
- **Unused params**: Prefix with underscore (`_param`) to satisfy strict checks

## Architecture

- `src/extension.ts` - Entry point, orchestrates activation
- `src/core/` - Shared utilities (python integration, env, paths, webview helpers)
- `src/providers/` - VS Code features (activity bar, log viewer, commands, codelens)
- `src/inspect/` and `src/scout/` - Package integrations

## Before Committing Changes

- Be sure to use `pnpm check-all` to run formatting, linting, and testing before committing.

## Gotchas

- Extension only activates when a workspace folder is open
- Requires minimum Inspect AI version 0.3.8
- Webview files in `src/providers/activity-bar/webview/` are excluded from eslint (separate build target)
