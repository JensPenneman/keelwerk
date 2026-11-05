/** One HTTP request the CLI makes. */
export interface HostRequest {
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

/** The file system, reduced to what the CLI reads and writes. */
export interface HostFiles {
  /** `undefined` when the file does not exist. */
  readText(path: string): Promise<string | undefined>;
  readBytes(path: string): Promise<Uint8Array>;
  /** Creates missing parent directories (mode 0700) and leaves the file with exactly `mode`. */
  writeText(path: string, text: string, mode: number): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** How a child process ends: its exit code, or the signal that stopped it. */
export interface HostExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** What a child process is started with; the output arrives as text chunks. */
export interface HostSpawnOptions {
  readonly cwd?: string;
  /** Replaces the environment of the child; absent: the host's own. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly onStdout?: (text: string) => void;
  readonly onStderr?: (text: string) => void;
}

/** A running child process. */
export interface HostProcess {
  /** Settles once, when the child has ended; a child that cannot start settles with code 127. */
  readonly exited: Promise<HostExit>;
  kill(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): void;
}

/** A recursive watch of a directory tree. */
export interface HostWatcher {
  close(): void;
}

/**
 * Everything the CLI takes from the machine it runs on. Commands receive it through the context,
 * so tests inject a fake and nothing touches process globals.
 */
export interface CliHost {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly homeDir: string;
  /** Standard output is a terminal. */
  readonly interactive: boolean;
  /** Standard input is a terminal, so a secret can be prompted for. */
  readonly stdinInteractive: boolean;
  readonly files: HostFiles;
  fetch(url: string, request: HostRequest): Promise<Response>;
  /** A request to a Unix socket; `path` includes the query. */
  fetchSocket(socketPath: string, path: string, request: HostRequest): Promise<Response>;
  /** Epoch milliseconds. */
  now(): number;
  /** A fresh UUIDv7. */
  newId(): string;
  sleep(milliseconds: number): Promise<void>;
  readStdin(): Promise<string>;
  /** Reads one line from the terminal, echoed as it is typed; `label` is printed as given. */
  promptLine(label: string): Promise<string>;
  /** Reads one line from the terminal without echo. */
  promptSecret(label: string): Promise<string>;
  /** Starts a child process; the host never waits for it. */
  spawn(command: string, args: readonly string[], options: HostSpawnOptions): HostProcess;
  /** Calls `callback` once after `milliseconds`; the returned function cancels it. The timer keeps the process alive only until it fires or is cancelled. */
  schedule(milliseconds: number, callback: () => void): () => void;
  /** Watches `root` recursively; `onChange` receives the changed path relative to `root`, with `/` separators. */
  watchTree(
    root: string,
    onChange: (path: string) => void,
    onError?: (message: string) => void,
  ): HostWatcher;
}
