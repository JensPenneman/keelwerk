import type { CliHost } from './cli-host.ts';
import { configDir } from './config-dir.ts';
import { usageFailure } from './usage-failure.ts';

function parseCredentials(text: string): Credentials {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw usageFailure('credentials.json is not valid JSON.');
  }
  const record = (raw ?? {}) as Readonly<Record<string, unknown>>;
  const entries =
    typeof record.credentials === 'object' && record.credentials !== null
      ? Object.entries(record.credentials)
      : [];
  const found: [string, { readonly token: string }][] = [];
  for (const [key, value] of entries) {
    const token = (value as Readonly<Record<string, unknown>> | null)?.token;
    if (typeof token === 'string' && token !== '') {
      found.push([key, { token }]);
    }
  }
  return Object.fromEntries(found);
}

/** Credentials by key: the profile name unless the profile names another key. */
export type Credentials = Readonly<Record<string, { readonly token: string }>>;

export interface CredentialsStore {
  readonly path: string;
  read(): Promise<Credentials>;
  write(credentials: Credentials): Promise<void>;
}

/** `credentials.json` next to the profiles, always written with mode 0600 (section 16.9.6). */
export function credentialsFile(host: CliHost): CredentialsStore {
  const path = `${configDir(host)}/credentials.json`;
  return {
    path,
    async read() {
      const text = await host.files.readText(path);
      return text === undefined ? {} : parseCredentials(text);
    },
    async write(credentials) {
      await host.files.writeText(path, `${JSON.stringify({ credentials }, null, 2)}\n`, 0o600);
    },
  };
}
