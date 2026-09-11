import * as assert from "assert";
import { ChildProcess, spawn } from "child_process";
import { once } from "events";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { createServer } from "http";
import { tmpdir } from "os";
import { join } from "path";

import { ExtensionContext, Uri, window } from "vscode";

import { PackageManager } from "../../core/package/manager";
import { PackageViewServer } from "../../core/package/view-server";
import type { HttpProxyRpcRequest } from "../../core/package/view-server";
import * as paths from "../../core/path";
import * as ports from "../../core/port";
import * as processes from "../../core/process";
import * as python from "../../core/python/exec";
import { HostWebviewPanel } from "../../hooks";
import { LogviewPanel } from "../../providers/logview/logview-panel";

import {
  MockChildProcess,
  MockExtensionContext,
  MockOutputChannel,
  MockPackageManager,
  waitFor,
} from "./view-server-mocks";

class TestServer extends PackageViewServer {
  constructor(
    manager: MockPackageManager,
    packageName: "inspect_ai" | "inspect_scout" = "inspect_ai"
  ) {
    super(
      new MockExtensionContext() as unknown as ExtensionContext,
      manager as unknown as PackageManager,
      ["view"],
      7676,
      "Test",
      "test",
      () => paths.toAbsolutePath(process.execPath),
      [],
      undefined,
      packageName
    );
  }
  start() {
    return this.ensureRunning();
  }
  json() {
    return this.api_json("/api/dist");
  }
  bytes() {
    return this.api_bytes("/api/bytes");
  }
  resource(data: unknown) {
    return this.resourcePath(JSON.stringify(data));
  }
}

suite("PackageViewServer lifecycle", () => {
  let server: TestServer;
  let manager: MockPackageManager;
  let children: MockChildProcess[];
  let outputs: Array<NonNullable<Parameters<typeof processes.spawnProcess>[3]>>;
  let tokens: string[];
  let calls: Array<{ url: string; options?: RequestInit }>;
  let outputChannel: MockOutputChannel;
  let originalPython: typeof python.runPython;
  let originalFetch: typeof fetch;
  let originalOutputChannel: typeof window.createOutputChannel;
  let originals: {
    spawnProcess: typeof processes.spawnProcess;
    runProcess: typeof processes.runProcess;
    findOpenPort: typeof ports.findOpenPort;
    activeWorkspacePath: typeof paths.activeWorkspacePath;
  };

  setup(() => {
    originals = {
      spawnProcess: processes.spawnProcess,
      runProcess: processes.runProcess,
      findOpenPort: ports.findOpenPort,
      activeWorkspacePath: paths.activeWorkspacePath,
    };
    originalPython = python.runPython;
    Object.assign(python, {
      runPython: () => JSON.stringify(join(tmpdir(), "unused-view-cache")),
    });
    originalFetch = global.fetch;
    originalOutputChannel = window.createOutputChannel;
    Object.assign(window, {
      createOutputChannel: (name: string) => {
        outputChannel = new MockOutputChannel(name);
        return outputChannel;
      },
    });
    children = [];
    outputs = [];
    tokens = [];
    calls = [];
    Object.assign(ports, {
      findOpenPort: () => Promise.resolve(7676 + children.length),
    });
    Object.assign(paths, {
      activeWorkspacePath: () => paths.toAbsolutePath(tmpdir()),
    });
    const spawnMock: typeof processes.spawnProcess = (
      _cmd,
      _args,
      options,
      io,
      lifecycle
    ) => {
      const child = new MockChildProcess();
      if (lifecycle?.onClose) child.on("close", lifecycle.onClose);
      if (lifecycle?.onError) child.on("error", lifecycle.onError);
      children.push(child);
      outputs.push(io!);
      tokens.push(options.env!.INSPECT_VIEW_AUTHORIZATION_TOKEN!);
      return child as unknown as ChildProcess;
    };
    Object.assign(processes, { spawnProcess: spawnMock });
    global.fetch = (url, options) => {
      calls.push({
        url:
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url,
        options,
      });
      return Promise.resolve(
        new Response('{"ok":true}', {
          headers: { "Content-Type": "application/json" },
        })
      );
    };
    manager = new MockPackageManager();
    server = new TestServer(manager);
  });
  teardown(() => {
    server.dispose();
    Object.assign(python, { runPython: originalPython });
    Object.assign(processes, {
      spawnProcess: originals.spawnProcess,
      runProcess: originals.runProcess,
    });
    Object.assign(ports, { findOpenPort: originals.findOpenPort });
    Object.assign(paths, {
      activeWorkspacePath: originals.activeWorkspacePath,
    });
    global.fetch = originalFetch;
    Object.assign(window, { createOutputChannel: originalOutputChannel });
  });
  async function ready(index = 0) {
    await waitFor(() => children.length > index);
    outputs[index]!.stdout!("Running on http://127.0.0.1\n");
  }

  test("malformed proxy input leaves the shared child and in-flight requests alive", async () => {
    const starting = server.start();
    await ready();
    await starting;
    let finish!: (response: Response) => void;
    global.fetch = () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      });
    const otherPanel = server.json();
    await waitFor(() => finish !== undefined);
    for (const request of [
      { method: "GET", path: "api/log-dir" },
      { method: "GET", path: "/api/log-dir", body: "x" },
      { method: "GET X", path: "/api/log-dir" },
      { method: "GET", path: "/api/log-dir", headers: { test: "x\ny" } },
      {
        method: "GET",
        path: "/api/log-dir",
        headers: { "content-length": "100" },
      },
      { method: "POST", path: "/api/log-dir", body: {} },
      null,
    ]) {
      await assert.rejects(
        server.proxyRpcRequest(request as HttpProxyRpcRequest)
      );
      assert.strictEqual(children[0]!.killed, false);
      assert.strictEqual(children.length, 1);
    }
    finish(new Response("other panel completed"));
    assert.strictEqual((await otherPanel).data, "other panel completed");
    assert.strictEqual(children[0]!.killed, false);
  });

  test("concurrent startup waits for a split readiness banner and shares one child", async () => {
    const requests = [
      server.json(),
      server.bytes(),
      server.proxyRpcRequest({ method: "GET", path: "/api/test" }),
    ];
    await waitFor(() => children.length === 1);
    assert.strictEqual(calls.length, 0);
    outputs[0]!.stderr!("noise\nRunn");
    outputs[0]!.stderr!("ing on http://127.0.0.1\n");
    await Promise.all(requests);
    assert.strictEqual(children.length, 1);
    assert.strictEqual(calls.length, 3);
    assert.ok(
      calls.every(
        (call) =>
          new Headers(call.options?.headers).get("Authorization") === tokens[0]
      )
    );
  });

  for (const signal of ["SIGKILL", "SIGTERM"] as const) {
    test(`restarts and rotates credentials after ${signal} with null exitCode`, async () => {
      const first = server.json();
      await ready();
      await first;
      children[0]!.simulateSignal(signal);
      assert.strictEqual(children[0]!.exitCode, null);
      const second = server.json();
      await ready(1);
      await second;
      assert.notStrictEqual(tokens[0], tokens[1]);
      assert.ok(calls[1]!.url.includes(":7677/"));
      assert.strictEqual(
        new Headers(calls[1]!.options?.headers).get("Authorization"),
        tokens[1]
      );
    });
  }

  for (const outcome of ["exit", "close", "signal", "error"] as const) {
    test(`early ${outcome} rejects startup and releases the lock for a queued retry`, async () => {
      const rejected = assert.rejects(
        server.json(),
        /exited before readiness|spawn failed/
      );
      const retry = server.json();
      await waitFor(() => children.length === 1);
      if (outcome === "exit") {
        children[0]!.exitCode = 1;
        children[0]!.emit("exit", 1, null);
      }
      if (outcome === "close") children[0]!.emit("close", 1, null);
      if (outcome === "signal") children[0]!.simulateSignal("SIGKILL");
      if (outcome === "error")
        children[0]!.triggerError(new Error("spawn failed"));
      await rejected;
      assert.strictEqual(calls.length, 0);
      await ready(1);
      await retry;
      assert.strictEqual(calls.length, 1);
    });
  }

  test("timeout kills a silent child; late output/close cannot affect its replacement", async () => {
    Object.assign(server, { startupTimeoutMs_: 25 });
    await assert.rejects(server.start(), /timed out/);
    assert.strictEqual(children[0]!.killed, true);
    assert.match(outputChannel.getOutput(), /startup timed out after/);
    Object.assign(server, { startupTimeoutMs_: 1000 });
    const retry = server.json();
    await ready(1);
    await retry;
    outputs[0]!.stdout!("Running on stale server");
    children[0]!.emit("close", null, "SIGTERM");
    children[0]!.triggerError(new Error("late error"));
    await server.json();
    assert.strictEqual(children.length, 2);
  });

  test("package change cancels pending startup and late old-child events are harmless", async () => {
    const rejected = assert.rejects(server.start(), /cancelled/);
    await waitFor(() => children.length === 1);
    manager.triggerChange();
    await rejected;
    const retry = server.json();
    await ready(1);
    await retry;
    children[0]!.emit("exit", null, "SIGTERM");
    await server.json();
    assert.strictEqual(children.length, 2);
  });

  test("dispose during port discovery releases all waiters and prevents late spawn", async () => {
    let resolvePort!: (port: number) => void;
    Object.assign(ports, {
      findOpenPort: () =>
        new Promise<number>((resolve) => {
          resolvePort = resolve;
        }),
    });
    const first = assert.rejects(server.start(), /cancelled/);
    const second = assert.rejects(server.start(), /disposed/);
    await waitFor(() => !!resolvePort);
    server.dispose();
    await Promise.all([first, second]);
    resolvePort(7676);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(children.length, 0);
  });

  test("signalCode guard catches termination before its event is handled", async () => {
    const first = server.start();
    await ready();
    await first;
    children[0]!.signalCode = "SIGKILL";
    const retry = server.json();
    await ready(1);
    await retry;
    assert.strictEqual(children.length, 2);
  });

  test("rejects a stale response even when fetch ignores abort", async () => {
    let resolveBody!: (body: string) => void;
    global.fetch = () =>
      Promise.resolve({
        ok: true,
        headers: new Headers(),
        text: () =>
          new Promise<string>((resolve) => {
            resolveBody = resolve;
          }),
      } as Response);
    const rejected = assert.rejects(server.json(), /stopped during request/);
    await ready();
    await waitFor(() => !!resolveBody);
    children[0]!.simulateSignal("SIGKILL");
    resolveBody('{"path":"/tmp/impostor"}');
    await rejected;
  });

  test("connection failure invalidates the instance and retries with a new token", async () => {
    global.fetch = () => Promise.reject(new Error("connection refused"));
    const rejected = assert.rejects(server.json(), /connection refused/);
    await ready();
    await rejected;
    const retry = server.start();
    await ready(1);
    await retry;
    assert.notStrictEqual(tokens[0], tokens[1]);
  });

  test("real server restarts after SIGKILL without contacting an impostor on its old port", async function () {
    if (process.platform === "win32") this.skip();
    this.timeout(10000);
    const liveChildren: ChildProcess[] = [];
    const livePorts: number[] = [];
    let impostorRequests = 0;
    const impostor = createServer((_request, response) => {
      impostorRequests++;
      response.end("impostor");
    });
    Object.assign(ports, { findOpenPort: originals.findOpenPort });
    const spawnLive: typeof processes.spawnProcess = (
      _cmd,
      args,
      options,
      io,
      lifecycle
    ) => {
      const port = Number(args[args.indexOf("--port") + 1]);
      livePorts.push(port);
      tokens.push(options.env!.INSPECT_VIEW_AUTHORIZATION_TOKEN!);
      const child = originals.spawnProcess(
        process.execPath,
        [
          "-e",
          `
        require('http').createServer((req, res) => {
          if (req.headers.authorization !== process.env.INSPECT_VIEW_AUTHORIZATION_TOKEN) {
            res.writeHead(401); res.end(); return;
          }
          res.end('trusted');
        }).listen(${port}, '127.0.0.1', () => console.log('Running on loopback'));
      `,
        ],
        { ...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: "1" } },
        io,
        lifecycle
      );
      liveChildren.push(child);
      return child;
    };
    Object.assign(processes, { spawnProcess: spawnLive });
    global.fetch = originalFetch;
    try {
      assert.strictEqual((await server.json()).data, "trusted");
      const first = liveChildren[0]!;
      const closed = once(first, "close");
      first.kill("SIGKILL");
      await closed;
      assert.strictEqual(first.exitCode, null);
      assert.strictEqual(first.signalCode, "SIGKILL");
      await new Promise<void>((resolve, reject) => {
        impostor.once("error", reject);
        impostor.listen(livePorts[0], "127.0.0.1", resolve);
      });
      assert.strictEqual((await server.json()).data, "trusted");
      assert.notStrictEqual(livePorts[0], livePorts[1]);
      assert.notStrictEqual(tokens[0], tokens[1]);
      assert.strictEqual(impostorRequests, 0);
    } finally {
      server.dispose();
      for (const child of liveChildren) child.kill("SIGKILL");
      await new Promise<void>((resolve) => impostor.close(() => resolve()));
    }
  });

  test("real Node child terminated by SIGKILL has null exitCode and a signalCode", async function () {
    if (process.platform === "win32") this.skip();
    const child = spawn(
      process.execPath,
      ["-e", 'console.log("ready");setInterval(() => {}, 1000)'],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    try {
      await once(child.stdout, "data");
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      assert.deepStrictEqual(await exited, [null, "SIGKILL"]);
      assert.strictEqual(child.exitCode, null);
      assert.strictEqual(child.signalCode, "SIGKILL");
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("resource paths are confined to the CLI-discovered package, including symlinks", () => {
    const temp = mkdtempSync(join(tmpdir(), "view-resource-"));
    try {
      const root = join(temp, "package");
      const dist = join(root, "_view", "dist");
      const outside = join(temp, "impostor");
      mkdirSync(dist, { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(dist, "index.html"), "trusted");
      writeFileSync(join(outside, "index.html"), "untrusted");
      Object.assign(processes, {
        runProcess: () => JSON.stringify({ path: root }),
      });
      assert.strictEqual(server.resource({ path: dist })?.path, dist);
      assert.strictEqual(server.resource(null), null);
      for (const value of [
        { path: outside },
        { path: root },
        { path: "relative" },
        {},
        { path: 1 },
      ]) {
        assert.throws(() => server.resource(value));
      }
      symlinkSync(outside, join(root, "escape"), "junction");
      assert.throws(
        () => server.resource({ path: join(root, "escape") }),
        /outside/
      );
      rmSync(join(dist, "index.html"));
      symlinkSync(join(outside, "index.html"), join(dist, "index.html"));
      assert.throws(() => server.resource({ path: dist }), /outside/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  for (const packageName of ["inspect_ai", "inspect_scout"] as const) {
    test(`${packageName} accepts only its locally discovered LFS dist cache and caches discovery until package change`, () => {
      server.dispose();
      server = new TestServer(manager, packageName);
      const temp = mkdtempSync(join(tmpdir(), "view-lfs-"));
      try {
        const root = join(temp, "checkout", packageName);
        const dist = join(root, "_view", "dist");
        const cache = join(temp, "user-cache", packageName, "dist");
        const unrelated = join(temp, "user-cache", "unrelated");
        for (const dir of [dist, cache, unrelated, join(cache, "nested")]) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "index.html"), "<html>resolved</html>");
        }
        writeFileSync(
          join(dist, "index.html"),
          "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n"
        );
        let cliCalls = 0;
        let cacheCalls = 0;
        Object.assign(processes, {
          runProcess: () => {
            cliCalls++;
            return JSON.stringify({ path: root });
          },
        });
        Object.assign(python, {
          runPython: (args: string[]) => {
            cacheCalls++;
            assert.strictEqual(args[args.length - 1], packageName);
            assert.ok(args[1]!.includes("user_cache_path"));
            return JSON.stringify(cache);
          },
        });
        for (let i = 0; i < 3; i++)
          assert.strictEqual(server.resource({ path: cache })?.path, cache);
        assert.strictEqual(cliCalls, 1);
        assert.strictEqual(cacheCalls, 1);
        for (const path of [
          unrelated,
          join(cache, ".."),
          join(cache, "nested"),
        ]) {
          assert.throws(() => server.resource({ path }), /outside/);
        }
        rmSync(join(cache, "index.html"));
        symlinkSync(join(unrelated, "index.html"), join(cache, "index.html"));
        assert.throws(() => server.resource({ path: cache }), /outside/);
        rmSync(join(cache, "index.html"));
        writeFileSync(join(cache, "index.html"), "resolved");
        manager.triggerChange();
        assert.strictEqual(server.resource({ path: cache })?.path, cache);
        assert.strictEqual(cliCalls, 2);
        assert.strictEqual(cacheCalls, 2);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  }

  test("preserves a validated symlink path and registers the selected assets in the log webview", async () => {
    const temp = mkdtempSync(join(tmpdir(), "view-symlink-"));
    try {
      const root = join(temp, "package");
      const dist = join(root, "dist");
      const alias = join(temp, "package-alias");
      mkdirSync(dist, { recursive: true });
      writeFileSync(
        join(dist, "index.html"),
        '<html><script src="./assets/view.js"></script></html>'
      );
      symlinkSync(root, alias, "junction");
      Object.assign(processes, {
        runProcess: () => JSON.stringify({ path: alias }),
      });
      const candidate = join(alias, "dist");
      const validated = server.resource({ path: candidate });
      assert.strictEqual(validated?.path, candidate);
      const host = {
        webview: {
          options: {
            enableScripts: true,
            localResourceRoots: [Uri.file(join(temp, "old-assets"))],
          },
          asWebviewUri: (uri: Uri) => uri,
          cspSource: "https://test.invalid",
        },
      } as unknown as HostWebviewPanel;
      const panel = Object.create(LogviewPanel.prototype) as LogviewPanel;
      Object.assign(panel, {
        panel_: host,
        server_: { getDistPath: () => Promise.resolve(validated) },
        context_: {
          extensionUri: Uri.file(temp),
          extension: { packageJSON: { version: "1.0" } },
        },
      });
      const state = { log_dir: Uri.file(temp) };
      const html = await panel.getHtml(state);
      assert.ok(html.includes("view.js"));
      assert.ok(
        host.webview.options.localResourceRoots?.some(
          (uri) => uri.toString() === Uri.file(candidate).toString()
        )
      );
      await panel.getHtml(state);
      assert.strictEqual(host.webview.options.localResourceRoots?.length, 2);
      assert.strictEqual(host.webview.options.enableScripts, true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
