# Command-file operations

The command directory is an **unauthenticated request channel**. Knowing its path
allows a writer to invoke only the operations below, with validated targets. The
workspace ID is routing metadata, not a secret; mode 0700 excludes other OS users,
not same-user writers. Writer authentication is not claimed or required by this
operation boundary. The extension never forwards a supplied VS Code command ID or
shell command.

Each file contains a JSON array of 1–16 requests with exactly `command` and `args`.
The whole batch is validated before any operation. Unknown commands, extra fields,
invalid arguments and mixed invalid batches are rejected with bounded diagnostics.

## Open a log

```json
[
  {
    "command": "inspect.openLogViewer",
    "args": ["file:///workspace/logs/run.eval?sample_id=42&epoch=1"]
  }
]
```

The argument is one URI, at most 8192 characters, with a `.eval` or `.json` path.
Supported schemes are `file`, `http`, `https`, `s3`, `gs`, `gcs`, `az`, `abfs` and
`abfss`; the active Python environment must have the corresponding storage backend.
Executable URI schemes, fragments, control characters, ambiguous authorities,
backslashes, extra arguments and unknown/duplicate query parameters are rejected.
Only `sample_id` and a non-negative safe-integer `epoch` are accepted. Sample IDs
are opaque text; the viewer's `jsonForScript` encoding protects embedded HTML.
Older Python Windows drive-path forms are normalized only when unambiguously local.

Ordinary local log requests open **without confirmation**. Remote logs inside the
configured log directory or open workspace also open directly. A remote location
outside those roots requires a targeted confirmation because fetching can use
ambient storage credentials. UNC/hosted file locations are accepted only inside
those roots; an unconfigured SMB target is rejected before filesystem access.
Containment requires the same scheme/authority and normalized path boundaries.

The extension explicitly selects Inspect's editor instead of consulting arbitrary
editor associations. Its older viewer remains supported. The operation can display
any locally readable `.eval`/`.json` target; it is not a workspace-only read sandbox.
The normal viewer and Python storage layer still parse the content and may follow
local symlinks, network redirects or backend configuration. It does not return data
to the request writer, but a writer can cause log displays and repeated work. A
storage backend can fetch using the user's credentials. These are residual powers
of the accepted operation, not proof of writer identity or complete filesystem and
network confinement. Task execution, extension installation, arbitrary terminal
input and deleting logs are not available through this channel.

## Docker sandbox operations

```json
[
  {
    "command": "inspect.openSandboxTerminal",
    "args": [{ "container": "inspect-task-service-1", "user": "1000:1000" }]
  }
]
```

```json
[
  {
    "command": "inspect.attachSandbox",
    "args": [{ "container": "inspect-task-service-1" }]
  }
]
```

Only a container name or full ID and, for terminals only, an optional Unix user or
UID (optionally with a group/GID) are accepted. Shell text, command arguments,
options and other fields are rejected. No container-name prefix is trusted.

The extension queries `docker ps` without a shell, with bounded output and timeout.
The request must match exactly one running container from that daemon. The user
then selects that actual target, with its full ID and requested operation/user
shown. This selection provides the trusted context: the extension has no independent
inventory binding terminal-launched evaluations to a workspace. Merely knowing a
container name or writing a request cannot start a terminal or attachment.

After selection the extension rechecks the full ID to prevent name reuse from
retargeting the operation. A terminal launches `docker` directly with the fixed
argument vector `exec -it [--user USER] FULL_ID bash -l`. No `sendText`, shell parser
or supplied shell string is used. Attachment calls the constant Dev Containers
attach action with the full ID. This permits an interactive container shell or
installation of the Dev Containers server in a **user-selected** container, including
containers not launched by Inspect. It does not create, build or modify container
configuration. Docker context/PATH and the selected container's setup are trusted
user environment, not file inputs. Docker access and, for attachment, Dev Containers
must be installed on the appropriate extension host.

## Producer compatibility and rollout

Existing Python log/sample requests retain their wire format. The extension
advertises supported command IDs in `INSPECT_VSCODE_OPERATIONS` for new terminals
and debug launches. This is capability negotiation only, not a credential.

Older producers still send terminal creation plus arbitrary `sendSequence` text,
or a plugin-supplied VS Code command. Those forms remain rejected. A minimal paired
producer patch is required to preserve the sandbox buttons: emit the typed requests
above when advertised; carry the Docker user as a structured connection field;
keep legacy behavior with older extensions; display existing manual instructions
for unsupported sandbox types/capabilities. The proposed patch is review evidence,
not a published producer change. Until paired release, old sandbox buttons do not
work with this extension. This is an explicit rollout prerequisite, not parity.
Non-Docker plugins need separately specified adapters; their arbitrary shell strings
cannot be admitted. Restart terminals when changing extension capability versions.

## File handling and limits

The command directory must be a real directory, with canonical path and identity
checked before cleanup, reads and consumption. Native canonicalization resolves
Windows short-name aliases before watching and comparing event paths. Failure to
initialize the directory disables only this channel and warns once; the rest of
extension activation continues.

The reader opens the file and validates its descriptor, rather than trusting a
pathname check made before open. It requires a regular file, one hard link and at
most 64 KiB, checks that the directory entry matches the opened object before
reading, bounds the read and checks for modifications. POSIX no-follow/nonblocking
flags reject symlinks and permit rejecting FIFOs without blocking. Windows lacks
those flags: a reparse target can be opened briefly before descriptor/entry checks
reject it. Directory checks and final unlink are not atomic directory-relative
operations; a process able to replace ancestors can still race them. The change
eliminates the stale pre-open decision; it does not claim all pathname races or
same-user filesystem powers are eliminated.

Only fully validated requests are consumed. Other requests and invalid JSON remain.
Creation/change events are serialized; the queue and startup cleanup are capped at
64 entries, each read gets an initial attempt plus four 100 ms retries, and warnings
are rate limited. Late events for consumed files are ignored. Disposing the channel
prevents pending authorizations from starting actions. Stalled writers, flooding or
writes during watcher startup are not guaranteed delivery; the directory is not a
reliable message queue. The producer creates then writes a file, so partial writes
are retried without requiring an atomic producer rename.

Routing stays on the extension host shared with Python, including remote hosts,
devcontainers and WSL. Platform CI, isolated watcher tests, paired producer payload
checks and runtime evidence are recorded in the PR; Docker integration and remote
host behavior require their own environment and must not be inferred from parser
tests alone.
