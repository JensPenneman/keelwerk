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
  /** Reads one line from the terminal without echo. */
  promptSecret(label: string): Promise<string>;
}
