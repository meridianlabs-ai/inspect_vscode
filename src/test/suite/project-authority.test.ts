import * as assert from "assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { Uri } from "vscode";

import { locationInScope } from "../../core/package/location-scope";
import * as paths from "../../core/path";
import {
  captureProjectAuthority,
  defaultProjectTranscripts,
} from "../../providers/scanview/project-authority";
import {
  normalizeScoutProjectConfig,
  ScoutProjectManager,
} from "../../providers/scout/scout-project";

suite("Effective project authority", () => {
  test("reads local overrides with atomic model settings and freezes their authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "scout-authority-"));
    const original = paths.activeWorkspacePath;
    Object.assign(paths, {
      activeWorkspacePath: () => paths.toAbsolutePath(root),
    });
    try {
      const base = normalizeScoutProjectConfig({
        scans: "./old",
        model_base_url: "https://old.example",
        model_roles: {
          grader: { model: "x", base_url: "https://old-role.example" },
        },
      });
      const manager = Object.create(
        ScoutProjectManager.prototype
      ) as ScoutProjectManager;
      Object.assign(manager, { getConfig: () => base });
      writeFileSync(
        join(root, "scout.local.yaml"),
        "transcripts: s3://team/external\nscans: /external/scans\nmodel_base_url: https://local.example\n"
      );
      const config = await manager.getAuthorityConfig();
      assert.strictEqual(config.scans, "/external/scans");
      assert.strictEqual(config.model_roles, undefined);
      const authority = captureProjectAuthority(config, (location) =>
        location.startsWith("/") ? Uri.file(location) : Uri.parse(location)
      );
      assert.ok(
        locationInScope(authority.transcripts, "s3://team/external/run")
      );
      assert.deepStrictEqual(authority.modelEndpoints, [
        "https://local.example",
      ]);
      writeFileSync(join(root, "scout.local.yaml"), "transcripts: /outside\n");
      assert.ok(!locationInScope(authority.transcripts, "/outside"));
      assert.strictEqual(base.transcripts, null);
    } finally {
      Object.assign(paths, { activeWorkspacePath: original });
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("default transcripts prefer the actual transcripts directory then host Inspect logs", async () => {
    const root = mkdtempSync(join(tmpdir(), "scout-default-"));
    try {
      const logs = Uri.parse("s3://team/logs");
      assert.strictEqual(
        await defaultProjectTranscripts(Uri.file(root), logs),
        logs.toString()
      );
      mkdirSync(join(root, "transcripts"));
      assert.strictEqual(
        await defaultProjectTranscripts(Uri.file(root), logs),
        Uri.file(join(root, "transcripts")).toString()
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
