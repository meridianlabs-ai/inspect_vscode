import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
} from "node:fs";

const kMaxBytes = 64 * 1024;

/** Pin a real directory and reject stable links or replacements before effects. */
export class CommandDirectory {
  readonly path: string;
  private readonly identity: { dev: number; ino: number };

  constructor(directory: string) {
    const state = lstatSync(directory);
    if (!state.isDirectory() || state.isSymbolicLink()) {
      throw new Error("Unsafe Inspect command directory.");
    }
    this.path = realpathSync.native(directory);
    this.identity = state;
    this.assertUnchanged();
  }

  assertUnchanged() {
    const current = lstatSync(this.path);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== this.identity.dev ||
      current.ino !== this.identity.ino
    ) {
      throw new Error("Inspect command directory was replaced.");
    }
  }
}

/** Read bounded regular-file data, using no-follow flags where supported. */
export function readCommandFile(
  file: string,
  validate: (value: unknown) => unknown,
  assertDirectory: () => void = () => {}
): unknown {
  assertDirectory();
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    // Check the opened object, not a pathname snapshot taken before open.
    // O_NONBLOCK makes opening a FIFO safe on POSIX; no data is read until
    // the descriptor is verified. Windows has no equivalent no-follow flag.
    const opened = fstatSync(fd);
    const entry = lstatSync(file);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size > kMaxBytes ||
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      opened.dev !== entry.dev ||
      opened.ino !== entry.ino
    ) {
      throw new Error(
        "Command request must be an unchanged regular file of at most 64 KiB."
      );
    }
    const buffer = Buffer.alloc(kMaxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    const after = fstatSync(fd);
    if (
      length > kMaxBytes ||
      after.size !== length ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs
    ) {
      throw new Error("Command file is too large or still being written.");
    }
    const value: unknown = JSON.parse(
      buffer.subarray(0, length).toString("utf8")
    );
    // Do not delete arbitrary JSON merely because it parsed successfully.
    validate(value);
    assertDirectory();
    const current = lstatSync(file);
    if (
      !current.isFile() ||
      current.dev !== after.dev ||
      current.ino !== after.ino ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs
    ) {
      throw new Error("Command file changed before consumption.");
    }
    // Consume only this request. Other pending files must not be discarded.
    unlinkSync(file);
    return value;
  } finally {
    closeSync(fd);
  }
}
