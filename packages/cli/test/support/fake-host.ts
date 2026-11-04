import type { CliHost, HostRequest } from '../../src/context/cli-host.ts';

export interface SentRequest {
  readonly url: string;
  readonly socketPath?: string;
  readonly request: HostRequest;
}

export type FakeHandler = (sent: SentRequest) => Response | Promise<Response>;

export interface FakeHostOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly interactive?: boolean;
  readonly stdinInteractive?: boolean;
  readonly stdin?: string;
  readonly secret?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly handler?: FakeHandler;
}

export interface FakeHost {
  readonly host: CliHost;
  readonly files: Map<string, { text: string; mode: number }>;
  readonly bytes: Map<string, Uint8Array>;
  readonly sent: SentRequest[];
  readonly sleeps: number[];
}

/** A host with an in-memory file system, a scripted network and a counting id source. */
export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
  const files = new Map<string, { text: string; mode: number }>();
  const bytes = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(options.files ?? {})) {
    files.set(path, { text, mode: 0o644 });
  }
  const sent: SentRequest[] = [];
  const sleeps: number[] = [];
  let counter = 0;
  const answer = async (request: SentRequest): Promise<Response> => {
    sent.push(request);
    if (options.handler === undefined) {
      throw new Error('no network in this test');
    }
    return await options.handler(request);
  };
  const host: CliHost = {
    env: options.env ?? {},
    cwd: options.cwd ?? '/work/project',
    homeDir: '/home/tester',
    interactive: options.interactive ?? false,
    stdinInteractive: options.stdinInteractive ?? options.interactive ?? false,
    files: {
      readText: async (path) => files.get(path)?.text,
      readBytes: async (path) => {
        const found = bytes.get(path);
        if (found === undefined) {
          throw new Error(`no bytes at ${path}`);
        }
        return found;
      },
      writeText: async (path, text, mode) => {
        files.set(path, { text, mode });
      },
      exists: async (path) => files.has(path),
    },
    fetch: (url, request) => answer({ url, request }),
    fetchSocket: (socketPath, path, request) => answer({ url: path, socketPath, request }),
    now: () => Date.parse('2026-11-05T09:30:00Z'),
    newId: () => {
      counter += 1;
      return `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`;
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    readStdin: async () => options.stdin ?? '',
    promptSecret: async () => options.secret ?? '',
  };
  return { host, files, bytes, sent, sleeps };
}
