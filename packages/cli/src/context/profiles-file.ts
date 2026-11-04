import type { CliHost } from './cli-host.ts';
import { configDir } from './config-dir.ts';
import type { Profile } from './profile.ts';
import type { ProfilesData } from './profiles-data.ts';
import { usageFailure } from './usage-failure.ts';

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseProfile(name: string, value: unknown): Profile {
  if (typeof value !== 'object' || value === null) {
    throw usageFailure(`Profile "${name}" in profiles.json is not an object.`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const url = asText(record.url);
  if (url === undefined) {
    throw usageFailure(`Profile "${name}" in profiles.json has no url.`);
  }
  const backend = asText(record.backend);
  const tenant = asText(record.tenant);
  const credential = asText(record.credential);
  return {
    url,
    ...(backend !== undefined && { backend }),
    ...(tenant !== undefined && { tenant }),
    ...(credential !== undefined && { credential }),
  };
}

function parseProfiles(text: string): ProfilesData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw usageFailure('profiles.json is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw usageFailure('profiles.json is not an object.');
  }
  const record = raw as Readonly<Record<string, unknown>>;
  const entries =
    typeof record.profiles === 'object' && record.profiles !== null
      ? Object.entries(record.profiles)
      : [];
  const current = asText(record.current);
  return {
    ...(current !== undefined && { current }),
    profiles: Object.fromEntries(entries.map(([name, value]) => [name, parseProfile(name, value)])),
  };
}

export interface ProfilesStore {
  readonly path: string;
  read(): Promise<ProfilesData>;
  write(data: ProfilesData): Promise<void>;
}

/** `$XDG_CONFIG_HOME/keelwerk/profiles.json`, written with mode 0600 (section 16.9.6). */
export function profilesFile(host: CliHost): ProfilesStore {
  const path = `${configDir(host)}/profiles.json`;
  return {
    path,
    async read() {
      const text = await host.files.readText(path);
      return text === undefined ? { profiles: {} } : parseProfiles(text);
    },
    async write(data) {
      await host.files.writeText(path, `${JSON.stringify(data, null, 2)}\n`, 0o600);
    },
  };
}
