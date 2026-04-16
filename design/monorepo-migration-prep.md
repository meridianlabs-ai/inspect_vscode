# Monorepo Migration Prep: Tooling Changes

## Context

The VS Code extension (`inspect_vscode`) will eventually move into the `ts-mono` monorepo (currently at `inspect_ai/src/inspect_ai/_view/ts-mono`) as `apps/vscode`. The two repos have significant tooling differences that should be reconciled **before** the move to keep the migration PR small and reviewable. This plan covers prep work we can do now in the standalone repo.

## Key Differences

| Area            | Extension (current)                     | Monorepo                                                        |
| --------------- | --------------------------------------- | --------------------------------------------------------------- |
| Package manager | yarn 1.22.22                            | pnpm 10.29.3                                                    |
| Build           | Webpack 5 (CommonJS ext + ESM webviews) | Vite                                                            |
| TypeScript      | ^5.7.0, ES2022/commonjs                 | ^6.0.2, ESNext/bundler                                          |
| ESLint          | v9 flat config w/ FlatCompat            | `@tsmono/eslint-config/base`                                    |
| Prettier        | `.prettierrc` (arrowParens: avoid)      | `@tsmono/prettier-config` (arrowParens: always, import sorting) |
| Testing         | Mocha + @vscode/test-electron           | Vitest + Playwright                                             |
| Node            | .nvmrc=18, engines>=20                  | >=22                                                            |
| Module type     | (not set, defaults CJS)                 | `"type": "module"`                                              |
| Orchestration   | N/A                                     | Turborepo                                                       |
| Script names    | compile, watch, package, prettier       | build, dev, build:production, format                            |

## Prep PRs (in order)

### ~~PR 1: Fix dependency categorization~~ ✅ Done

Moved `@eslint/eslintrc`, `@eslint/js`, `@types/glob`, `@types/semver` from `dependencies` to `devDependencies`. Also fixed `ELECTRON_RUN_AS_NODE` test runner issue (VS Code terminal sets this env var, causing the test Electron binary to run as plain Node.js).

### ~~PR 2: Prettier alignment~~ ✅ Done

Changed `arrowParens` to `"always"`, added `@ianvs/prettier-plugin-sort-imports` with monorepo import ordering, and reformatted entire codebase.

### ~~PR 3: ESLint modernization~~ ✅ Done

Rewrote eslint config: dropped `FlatCompat`, using `typescript-eslint` directly, added `eslint-config-prettier`, `eslint-plugin-import`, `eslint-import-resolver-typescript`, switched to `projectService`.

### ~~PR 4: TypeScript strictness alignment~~ ✅ Done

Enabled `noUncheckedIndexedAccess` and `useUnknownInCatchVariables`. Fixed 127 type errors across 31 files (source + test + webview).

### ~~PR 5: TypeScript 6 upgrade~~ ✅ Done

Upgraded TypeScript from ^5.7.0 to ^6.0.2. Only fix needed: added `src/@types/css.d.ts` for TS 6's stricter CSS side-effect import checking (TS2882) in webview files.

### ~~PR 6: Script renaming~~ ✅ Done

Renamed scripts to monorepo conventions (`build`, `dev`, `build:production`, `format`, `format:check`, `typecheck`, `check-all`). Updated CI, CLAUDE.md, and .vscode/tasks.json. Note: `type: module` was dropped — VS Code extension host + tsc CommonJS output conflicts with ESM package type. Will be handled during monorepo move (extension workspace can stay CJS while root is ESM).

### ~~PR 7: Package manager migration (yarn -> pnpm)~~ ✅ Done

Migrated from yarn 1.22.22 to pnpm 10.29.3. Deleted yarn.lock and .yarnrc, updated .nvmrc to 22, engines.node to >=22.0.0, all CI workflows to pnpm + Node 22, CLAUDE.md references, and added `vsce:package` script.

## What stays the same

- **Webpack** — Keep it. VS Code extensions need CommonJS Node output + separate webview bundles. Vite is not well-suited here. The webpack config is small and stable.
- **Mocha + @vscode/test-electron** — Keep it. VS Code integration tests need a real VS Code runtime that Vitest can't provide.
- **All VS Code-specific package.json fields** — `contributes`, `activationEvents`, `engines.vscode`, `extensionDependencies` are preserved as-is.

## Changes during the actual move (not now)

These happen when the code physically moves into `apps/vscode/`:

1. Create `tooling/tsconfig/node.json` extending `base.json` with `module: commonjs`, `target: ES2022`, `moduleResolution: node`, `noEmit: false`
2. Update `apps/vscode/tsconfig.json` to extend `@tsmono/tsconfig/node.json`
3. Update `apps/vscode/eslint.config.js` to import from `@tsmono/eslint-config/base`
4. Delete `.prettierrc` (inherits from monorepo root)
5. Add workspace devDeps: `@tsmono/tsconfig`, `@tsmono/eslint-config`, `@tsmono/prettier-config`
6. Update `turbo.json` build outputs to include `out/**`
7. Add monorepo CI job for VS Code-specific tasks (xvfb, vsce package, vsce publish)
8. Remove standalone repo CI workflows

## Risks

- **TypeScript 6 upgrade** — Highest risk. May require significant code changes. Do this early to uncover issues.
- **vsce + pnpm** — `vsce package --no-dependencies` sidesteps monorepo layout issues since webpack bundles everything.
- **Import sorting** — The prettier import sorting plugin will touch every file. Do this as an isolated PR to keep diffs clean.

## Verification

After each PR:

- `yarn check-all` (or `pnpm check` after PR 7) passes
- Extension loads and functions correctly in VS Code (`F5` to launch Extension Development Host)
- CI passes

After all prep PRs:

- The only remaining differences from monorepo conventions are the config imports (pointing at local configs vs `@tsmono/*` workspace packages)
- The actual move PR should be mostly file relocation + config import swaps
