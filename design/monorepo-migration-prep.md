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

### PR 1: Fix dependency categorization

Move misplaced packages from `dependencies` to `devDependencies`:

- `@eslint/eslintrc`, `@eslint/js` (lint tooling)
- `@types/glob`, `@types/semver` (type packages)

**Files:** [package.json](package.json)

### PR 2: Prettier alignment

- Change `arrowParens` from `"avoid"` to `"always"` in [.prettierrc](.prettierrc)
- Add `@ianvs/prettier-plugin-sort-imports` as devDependency
- Add `importOrder` config matching monorepo pattern:
  ```json
  [
    "<BUILTIN_MODULES>",
    "",
    "<THIRD_PARTY_MODULES>",
    "",
    "^@tsmono/",
    "",
    "^[.][.]",
    "",
    "^[.]/"
  ]
  ```
- Run `prettier --write .` to reformat entire codebase
- Pure formatting change, large diff but zero behavior change

**Files:** [.prettierrc](.prettierrc), [package.json](package.json), all `.ts` files (reformatted)

### PR 3: ESLint modernization

Rewrite [eslint.config.mjs](eslint.config.mjs) to match monorepo pattern:

- Drop `FlatCompat` — use `typescript-eslint` directly
- Add `eslint-config-prettier` and `eslint-plugin-import` to devDeps
- Switch from `parserOptions.project` to `parserOptions.projectService`
- Keep extension-specific rules (`naming-convention`, `curly`, `eqeqeq`, `no-throw-literal`)
- Fix any new lint errors from `recommendedTypeChecked`

**Files:** [eslint.config.mjs](eslint.config.mjs), [package.json](package.json)

### PR 4: TypeScript strictness alignment

Enable the two strict options the monorepo has that we don't:

- `noUncheckedIndexedAccess: true`
- `useUnknownInCatchVariables: true`

Fix all resulting type errors. This is the most valuable prep step — these rules catch real bugs.

**Files:** [tsconfig.json](tsconfig.json), various `.ts` source files

### PR 5: TypeScript 6 upgrade

- Bump `typescript` from `^5.7.0` to `^6.0.2`
- Fix any breaking changes (TS 6 changes may require code adjustments)
- This is the highest-risk prep item — budget time for this

**Files:** [package.json](package.json), potentially many `.ts` files

### PR 6: Script renaming + `type: module`

Rename scripts to match monorepo conventions:

| Old         | New                                   |
| ----------- | ------------------------------------- |
| `compile`   | `build`                               |
| `watch`     | `dev`                                 |
| `package`   | `build:production`                    |
| `prettier`  | `format`                              |
| (new)       | `format:check` (`prettier --check .`) |
| (new)       | `typecheck` (`tsc --noEmit`)          |
| `check-all` | `check`                               |

Also:

- Add `"type": "module"` to package.json
- Convert [webpack.config.js](webpack.config.js) from `require`/`module.exports` to `import`/`export default`
- Rename [eslint.config.mjs](eslint.config.mjs) to `eslint.config.js` (`.js` is ESM with `type: module`)
- Update `vscode:prepublish` to reference new names
- Update CI workflow references

**Files:** [package.json](package.json), [webpack.config.js](webpack.config.js), [eslint.config.mjs](eslint.config.mjs), [.github/workflows/ci.yml](.github/workflows/ci.yml)

### PR 7: Package manager migration (yarn -> pnpm)

- Delete `yarn.lock` and `.yarnrc`
- Remove `"packageManager": "yarn@1.22.22"` from package.json
- Update `.nvmrc` from `18` to `22`
- Update `engines.node` from `>=20.0.0` to `>=22.0.0`
- Update CI to use pnpm + Node 22
- Generate `pnpm-lock.yaml`
- Add `vsce:package` script: `vsce package --no-dependencies` (needed for pnpm monorepo compat)

**Files:** [package.json](package.json), [.nvmrc](.nvmrc), [.yarnrc](.yarnrc) (delete), `yarn.lock` (delete), [.github/workflows/ci.yml](.github/workflows/ci.yml), [.github/workflows/release.yml](.github/workflows/release.yml)

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
