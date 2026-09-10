# Command-file requests

The extension's command-file channel accepts a JSON array containing 1–16 entries:

```json
[
  {
    "command": "inspect.openLogViewer",
    "args": ["file:///workspace/logs/run.eval?sample_id=42&epoch=1"]
  }
]
```

Only this command is supported. Each entry must have exactly `command` and `args`,
with one URI string. The supported locations are local `file` URIs and
`http`, `https`, or `s3` URLs ending in `.eval` or `.json`. Hosted file/UNC paths,
fragments, control characters, extra arguments, duplicate or unknown query
parameters, and executable URI schemes are rejected. Sample selection uses
`sample_id` and a non-negative integer `epoch`.

The entire batch is validated before any prompt or viewer action. The user must
confirm the displayed locations before the extension opens them. The extension
selects Inspect's custom editor explicitly, bypassing workspace editor
associations; older Inspect versions use the existing Inspect view manager.
Opening a log can read local content or fetch a remote resource using the active
Python environment's credentials. Confirmation therefore applies to local and
remote requests alike, and does not permanently trust a writer or directory.

Files are limited to 64 KiB. Reads reject non-regular files and hard links, check
file identity and size, and use no-follow/nonblocking open flags where supported
by Node on the host platform. Only a successfully read request is consumed; other
pending requests are retained. Creation and change events are serialized through
a queue capped at 64 paths. Incomplete writes are retried five times at 100 ms
intervals; files that remain invalid are left in place, and a later change can
retry them. Existing files are not executed merely by activating the extension.
Diagnostics are bounded and rate limited. These controls bound each read and the
in-memory queue; they do not prevent a writer from filling its own writable
directory, repeatedly changing files, or causing repeated confirmation prompts.

## Compatibility and current limits

The Inspect producer writes the legacy JSON array directly to a randomly named
file. No wire-format change is required for its log and sample links. Evaluation
completion notifications and terminal links are separate extension features and
remain available. Producers with no log location emit an empty argument list;
this is rejected, as the viewer requires a target.

The Python human-agent panel also uses this channel for
`remote-containers.attachToRunningContainer`, and sandbox plugins can supply
other command IDs. Those requests are now rejected with a diagnostic directing
the user to the command palette. Manually invoking Dev Containers' attach action
remains available, but **the existing one-click Python container link is not
preserved by this candidate**. This compatibility decision must be resolved before
claiming the complete IPC migration is ready.

The extension host and Python process must share the existing platform-specific
Inspect data directory. That routing remains unchanged for remote extension
hosts, devcontainers, and WSL. URI and filesystem checks execute on that host;
remote-host behavior and Windows link/race handling still need platform evidence.

## Writer authentication: unresolved

This patch does **not** authenticate the file writer. Knowing only the directory
path can still submit a request, but cannot open a log without a user confirming
it. The confirmation authenticates a user decision, not the Python process.
The workspace ID is routing metadata. A mode-0700 directory excludes other OS
users under normal filesystem permissions, not another process running as the
same user. A token beside the requests, or a token inherited by every terminal
or evaluation process, would not establish a boundary against those writers.
The scoped threat is a file-write primitive or constrained same-user process;
there is no claim of protection from a fully privileged same-user adversary.

A coordinated protocol needs a trusted principal separate from untrusted eval
code. The current Python terminal UI and evaluation code can share a process;
a capability handed to that process is available to its eval code too. Merely
adding HMAC fields to this producer would not solve that problem.

### Proposed coordinated design (not implemented)

1. Run the trusted request UI/broker separately from evaluation code, launched
   by the extension. Bind it to an inherited duplex pipe or connected handle
   owned by the extension host. Do not publish a listening bearer capability in
   the command directory or terminal environment. Untrusted eval children must
   not inherit the handle. On Windows use explicitly restricted handle
   inheritance; on POSIX close it in eval children. Keep the broker and extension
   together on the remote host for remote/devcontainer/WSL sessions.
2. Bind each session to one workspace, a fresh random session ID, and a monotonic
   request sequence. Negotiate protocol 2 over that connected handle before
   accepting requests. Frame messages with a bounded length (64 KiB maximum).
   A request is `{version: 2, session, sequence, action, payload}`. The fixed
   actions are `open_log` with `{uri}` and `attach_container` with `{container_id}`.
   Validate the whole message, session, sequence and action schema before effects;
   reject replay, stale sessions, missing fields and unknown actions.
3. Treat eval-supplied display data as untrusted. Only a gesture in the trusted
   UI can submit an action. Keep explicit confirmation for container attachment
   and log targets that can fetch with ambient credentials. The extension maps
   each action to its own implementation and a constant downstream command;
   never accept a VS Code command ID from a protocol-2 payload. Validate an attach
   identifier against the broker's current evaluation/container inventory, not
   merely a printable-string pattern.
4. Keep protocol-1 log files as untrusted, per-request-confirmed requests during
   migration. Do not claim those writers are authenticated. Publish producer
   capability negotiation before advertising protocol-2 support. An old extension
   must cause the new producer to retain its legacy log UI; an old producer with
   the new extension retains confirmed log opening. No credential failure may
   downgrade to an automatically executed file. For legacy container links,
   choose either a separately confirmed adapter with a fixed action or a paired
   producer update that offers a manual command-palette fallback. That choice
   changes the strict extension-owned-ID policy and needs an explicit decision.
5. Validate extension and producer together: successful trusted UI gestures;
   missing/wrong handle or session; replay and sequence gaps; reconnect and host
   restart; eval-child inheritance; directory-only writer; malformed/oversized
   frames; old/new version pairs; arbitrary CLI evaluations; Docker attachment;
   Windows, Linux, remote extension host, devcontainer and WSL behavior.

A process-bound channel excludes directory-only writers and constrained processes
without the inherited handle. It does not defeat a process able to inspect the
broker's memory or duplicate its handles. Supporting arbitrary terminal-launched
Python UIs without trusting eval code needs a user-mediated pairing or moving
that UI into the extension, not a global token.

The remaining decision is whether per-request user authorization is the accepted
boundary for the legacy channel, and which coordinated broker/container migration
to implement. The viewer-only patch is reviewable mitigation, not completion of
writer authentication or the full compatibility requirement. No producer change
is included here.
