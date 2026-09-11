# Security Policy

## Reporting a Vulnerability

Please report suspected security vulnerabilities privately using GitHub's
[private vulnerability reporting](https://github.com/meridianlabs-ai/inspect_vscode/security/advisories/new)
for this repository ("Security" tab → "Report a vulnerability").

Please do **not** report security vulnerabilities through public GitHub issues.

When reporting, please include:

- A description of the issue and its potential impact
- Steps to reproduce (a proof of concept is helpful but not required)
- Affected extension version and VS Code/OS versions

We will acknowledge reports within 5 business days and keep you informed as we
work on a fix. We ask that you give us a reasonable opportunity to address the
issue before any public disclosure.

## Supported Versions

Security fixes are released for the latest published version of the extension
on the VS Code Marketplace and OpenVSX.

## Scope

This policy covers the Inspect AI VS Code extension. For issues in the
underlying frameworks, see the
[Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) and
[Inspect Scout](https://github.com/meridianlabs-ai/inspect_scout)
repositories.

## Threat model and trust boundaries

This section says what the extension treats as trusted and what it treats as
hostile. Security reports and code reviews should be judged against it: a
finding that requires an attacker who already holds a trusted position is a
robustness bug, not a vulnerability.

### The boundary is VS Code Workspace Trust

The extension declares `untrustedWorkspaces.supported: false`. It does not
activate in a workspace the user has not trusted, so every feature below runs
only after the user has told VS Code they trust the folder.

Trusting a workspace means accepting that its contents may run code with
the user's privileges. VS Code documents Workspace Trust as the feature that
"tries to prevent code execution while you are evaluating the safety and
integrity of unfamiliar source code"; once a folder is trusted, that
prevention is lifted. Workspace settings that name executables (interpreter
paths, terminal profiles, language-server and tool paths) take effect and are
used by VS Code and other extensions, often without a further prompt; tasks
and debug configurations from `.vscode/` run when the user invokes them.
This extension runs the workspace's Python source when the user runs a task
or scan, which is the same kind of user-initiated execution. An attacker who
controls a trusted workspace can therefore already execute arbitrary code on
the user's machine, independently of this extension.

The general rule follows: a finding is not a vulnerability if the attacker
it requires already holds a trusted position. Whoever controls a trusted
workspace, the selected Python environment, or the user's shell has already
been granted the ability to run code; a second, more indirect way to run
code from that same position adds no new capability. Such findings can
still be worth fixing as robustness or correctness bugs, but they are
judged and prioritized as bugs, not as security issues.

### Trusted inputs

The extension may read, interpret and execute these without further
confirmation:

- Workspace contents: task and scanner source, filenames and directory
  names, `.env` files, `pyproject.toml`, and anything the Python code
  imports.
- Workspace and user settings, including the selected Python interpreter,
  interpreter paths under the workspace, and `inspect_ai.*` settings.
- The selected Python environment reported by the Python extension, its
  activation, and packages installed in it (Inspect, Scout and their
  dependencies).
- The user's shell, shell profile and terminal environment.
- Arguments the user types or chooses in the extension's own UI (task
  parameters, limits, model names).

Because these inputs are trusted, defects in how the extension handles them
(for example a path that a shell misparses, or an interpreter that cannot be
found) are correctness and reliability bugs. They should be fixed when they
break legitimate use, but they are not vulnerabilities.

### Untrusted inputs

These cross into the workspace from elsewhere and are treated as hostile:

- **Eval and scan log contents** (`.eval`, `.json`, scan databases), whether
  local or remote. They contain model output, tool output and sandbox output,
  and may have been produced by other people or by a compromised model. The
  log viewer and scan viewer render them in webviews; the viewer bundle,
  the view server proxy and the webview HTML must treat every field as data.
- **Model, tool and sandbox output** surfaced anywhere in the extension UI
  (tooltips, tree items, notifications, markdown), including in the activity
  bar and CodeLens text. Interpolate as data; never as markdown commands or
  HTML.
- **URIs delivered through the OS URL handler**
  (`vscode://ukaisi.inspect-ai/...`). Any web page can trigger these. The
  handler must validate scheme, host and path against the open workspace
  and confirm with the user before opening anything.
- **Network responses**: remote log listings, S3/HTTP log fetches, the local
  view-server's proxied requests, and version metadata. Treat as untrusted
  data; keep the proxy scoped to the paths the viewer needs.
- **Content of files the user did not author** that the extension parses
  outside of running them: log files above, and any dataset or media
  referenced from a log.

### What is out of scope

- Attacks that require the user to trust a malicious workspace. Report these
  to the user education/Workspace Trust layer, not to this extension.
- Attacks by other local users on a shared machine against temporary files,
  beyond the default 0600/`mkdtemp` hygiene.
- Malicious VS Code extensions or a compromised Python extension.
- Hostile shells: a user's shell profile is theirs.

### How to apply this in review

- Ask first: "Does this attacker already control a trusted workspace or the
  selected environment?" If yes, the finding is robustness or correctness.
  Fix it when it breaks legitimate use; rank it below any untrusted-input
  finding.
- Ask second: "Does untrusted data (log content, model output, URL, network
  response) reach a webview, a markdown renderer, a shell, a file path, or a
  command?" If yes, that is the security surface. Look for HTML/markdown
  injection, path traversal out of the log directory, proxy scope, and URI
  handler validation.
- Judge a proposed mitigation by what it costs legitimate use. A control
  that only defends against a trusted party is not worth a worse user
  experience.
