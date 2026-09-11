// Check every route the Inspect and Scout view servers define against the
// webview http_request proxy's route table (src/core/package/proxy-scope.ts).
//
// The proxy rejects unrecognized routes by default, so a new upstream endpoint
// that the viewer starts depending on would otherwise surface as a silently
// broken panel. This script makes that visible: each server route is filled
// with in-scope placeholder values and run through the proxy's scope check.
// Every route must be either ALLOWED or on the explicit DENY list below
// (routes the proxy blocks on purpose). Anything else fails the check.
//
// Inputs (produced by dump-openapi.py): out/proxy-routes/{inspect,scout}.json
// Module under test (produced by `pnpm compile-tests`): out/core/package/proxy-scope.js
//
// Usage: node scripts/proxy-routes/check.mjs [--specs DIR] [--module FILE]

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const specsDir = resolve(args.specs ?? "out/proxy-routes");
const modulePath = resolve(args.module ?? "out/core/package/proxy-scope.js");

if (!existsSync(modulePath)) {
  fail(`${modulePath} not found. Run \`pnpm compile-tests\` first.`);
}
const { assertLogProxyInScope, assertScanProxyInScope } = createRequire(
  import.meta.url
)(modulePath);

// ---------------------------------------------------------------------------
// Placeholder scopes and values. The scope predicates only need to recognize
// these fixed roots; the real predicates (logPathInScope / scanLocationInScope)
// are exercised by the unit tests. What is under test here is route
// recognition and location extraction.
// ---------------------------------------------------------------------------
const LOG_DIR = "file:///w/logs";
const LOG = `${LOG_DIR}/run.eval`;
const SCANS_DIR = "file:///w/scans";
const TRANSCRIPTS_DIR = "s3://bucket/logs";
const VALIDATION = "file:///proj/validations/v.csv";

const under = (root) => (loc) => loc === root || loc.startsWith(root + "/");
const logInScope = under(LOG_DIR);
const scanInScope = under(SCANS_DIR);
const transcriptsInScope = (loc) =>
  scanInScope(loc) || under(TRANSCRIPTS_DIR)(loc);

const enc = encodeURIComponent;
const b64url = (v) => Buffer.from(v, "utf-8").toString("base64url");

// Query parameters that carry a location, and the in-scope value to send.
// Other query parameters are irrelevant to scoping and are omitted.
const LOCATION_QUERY = {
  log_dir: LOG_DIR,
  log: LOG,
  log_file: LOG,
  file: LOG,
  dir: "sub", // eval-set / flow subdirectory, joined onto log_dir
  results_dir: SCANS_DIR,
};

// Path parameter fill-ins, keyed by parameter name. {dir} is the log dir on
// the inspect server (its /scout/transcripts routes search the viewed logs);
// on scout it is the transcripts dir on /transcripts routes and the scans dir
// elsewhere.
function pathParamValue(name, template, server) {
  switch (name) {
    case "log":
      return enc(LOG);
    case "dir":
      if (server === "inspect") {
        return b64url(LOG_DIR);
      }
      return b64url(
        template.includes("/transcripts") ? TRANSCRIPTS_DIR : SCANS_DIR
      );
    case "scan":
      return b64url("scan_id=x");
    case "uri":
      return b64url(VALIDATION);
    case "case_id":
      return b64url("case-1");
    default:
      return "x"; // ids, scanner names, uuids, search ids
  }
}

// Routes the proxy blocks ON PURPOSE. Each entry needs a reason; an entry
// that the proxy starts allowing, or that disappears upstream, is reported.
const DENY = [
  {
    method: "DELETE",
    path: "/api/log-delete/{log}",
    reason:
      "neither the viewer nor the extension's named RPC surface deletes logs",
  },
  {
    method: "DELETE",
    path: "/api/v2/scans/{dir}/{scan}",
    reason:
      "the viewer never deletes scans through the proxy; the extension's tree commands call the server directly",
  },
];

// Routes served outside the OpenAPI'd sub-apps (added by the standalone server
// wrapper) that the viewer still requests through the proxy.
const EXTRA_ROUTES = {
  inspect: [{ method: "GET", path: "/api/dist", params: [] }],
  scout: [],
};

// ---------------------------------------------------------------------------

// Runtime method normalization must not change an authorization decision.
for (const method of ["delete", "Delete", "dElEtE", "GET X"]) {
  let rejected = false;
  try {
    assertScanProxyInScope(
      {
        method,
        path: `/api/v2/scans/${b64url(SCANS_DIR)}/${b64url("scan_id=x")}`,
      },
      scanInScope
    );
  } catch {
    rejected = true;
  }
  if (!rejected) fail(`Unexpected method accepted: ${method}`);
}
for (const [method, path] of [
  ["POST", "/api/v2/startscan"],
  ["PUT", "/api/v2/project/config"],
  ["POST", "/api/v2/validations"],
]) {
  let rejected = false;
  try {
    assertScanProxyInScope(
      { method, path, body: "{}" },
      scanInScope,
      transcriptsInScope,
      { fullView: false }
    );
  } catch {
    rejected = true;
  }
  if (!rejected)
    fail(`Single-scan editor accepted project mutation: ${method} ${path}`);
}
const results = [];
for (const [name, assertFn, inScope] of [
  ["inspect", assertLogProxyInScope, [logInScope]],
  [
    "scout",
    assertScanProxyInScope,
    [
      scanInScope,
      transcriptsInScope,
      {
        fullView: true,
        configScope: {
          scans: scanInScope,
          transcripts: transcriptsInScope,
          project: under("file:///proj"),
        },
      },
    ],
  ],
]) {
  const specFile = resolve(specsDir, `${name}.json`);
  if (!existsSync(specFile)) {
    fail(
      `${specFile} not found. Run scripts/proxy-routes/dump-openapi.py first.`
    );
  }
  const spec = JSON.parse(readFileSync(specFile, "utf-8"));
  const routes = [...routesFromOpenApi(spec), ...EXTRA_ROUTES[name]];
  for (const route of routes) {
    const request = { method: route.method, path: concretePath(route, name) };
    if (
      route.path === "/api/v2/startscan" ||
      (route.path === "/api/v2/project/config" && route.method === "PUT")
    ) {
      request.body = JSON.stringify({
        transcripts: TRANSCRIPTS_DIR,
        scans: SCANS_DIR,
        scanners: [{ name: "scanner", file: "file:///proj/scanner.py" }],
      });
    }
    let allowed = true;
    let error = "";
    try {
      assertFn(request, ...inScope);
    } catch (e) {
      allowed = false;
      error = e instanceof Error ? e.message : String(e);
    }
    const deny = DENY.find(
      (d) => d.method === route.method && d.path === route.path
    );
    results.push({
      server: `${spec.package} ${spec.version}`,
      method: route.method,
      template: route.path,
      concrete: request.path,
      allowed,
      denied: Boolean(deny),
      error,
    });
  }
}

const stale = DENY.filter(
  (d) => !results.some((r) => r.method === d.method && r.template === d.path)
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failures = [];
const lines = [];
for (const r of results) {
  let verdict;
  if (r.allowed && !r.denied) {
    verdict = "allow";
  } else if (!r.allowed && r.denied) {
    verdict = "deny (intended)";
  } else if (!r.allowed) {
    verdict = "BLOCKED (unrecognized)";
    failures.push(
      `${r.method} ${r.template} is blocked but not on the DENY list. ` +
        `Either add it to the route table in src/core/package/proxy-scope.ts ` +
        `(scoping any location it carries) or, if the webview must never reach ` +
        `it, add it to DENY in scripts/proxy-routes/check.mjs with a reason.`
    );
  } else {
    verdict = "ALLOWED (on deny list)";
    failures.push(
      `${r.method} ${r.template} is on the DENY list but the proxy allows it. ` +
        `Fix proxy-scope.ts or remove the DENY entry.`
    );
  }
  lines.push([r.server, r.method, r.template, verdict]);
}
for (const d of stale) {
  lines.push([
    "-",
    d.method,
    d.path,
    "stale DENY entry (route no longer served; safe to remove)",
  ]);
}

printTable(["server", "method", "route", "verdict"], lines);
console.log(
  `\n${results.length} routes checked, ${results.filter((r) => r.allowed).length} allowed, ` +
    `${DENY.length - stale.length} denied on purpose, ${failures.length} problem(s).`
);
writeStepSummary(lines, failures);

if (failures.length > 0) {
  console.error("\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function routesFromOpenApi(spec) {
  const routes = [];
  for (const [path, item] of Object.entries(spec.openapi.paths ?? {})) {
    for (const method of ["get", "post", "put", "delete", "head", "patch"]) {
      const op = item[method];
      if (!op) {
        continue;
      }
      routes.push({
        method: method.toUpperCase(),
        path: spec.prefix + path,
        params: [...(item.parameters ?? []), ...(op.parameters ?? [])],
      });
    }
  }
  return routes;
}

function concretePath(route, server) {
  const path = route.path.replace(/\{([^}]+)\}/g, (_m, name) =>
    pathParamValue(name, route.path, server)
  );
  const query = new URLSearchParams();
  for (const p of route.params) {
    if (p.in === "query" && p.name in LOCATION_QUERY) {
      query.append(p.name, LOCATION_QUERY[p.name]);
    }
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

function printTable(header, rows) {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length))
  );
  const fmt = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((r) => console.log(fmt(r)));
}

function writeStepSummary(rows, failures) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) {
    return;
  }
  const md = [
    failures.length
      ? `## Proxy route check: ${failures.length} problem(s)\n`
      : "## Proxy route check: all routes accounted for\n",
    ...failures.map((f) => `- ${f}`),
    "",
    "| server | method | route | verdict |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.map((c) => String(c).replace(/\\/g, "\\\\").replace(/\|/g, "\\|")).join(" | ")} |`
    ),
    "",
  ].join("\n");
  appendFileSync(file, md);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
