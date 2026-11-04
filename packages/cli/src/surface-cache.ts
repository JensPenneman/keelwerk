import type { ApiSurface } from '@keelwerk/core';
import { cacheDir } from './context/cache-dir.ts';
import type { CliHost } from './context/cli-host.ts';

export interface SurfaceCache {
  /** The hash cached for a connection, if any. */
  hashFor(key: string): Promise<string | undefined>;
  load(hash: string): Promise<ApiSurface | undefined>;
  /** Stores the surface under its hash and points `key` at it. */
  store(key: string, surface: ApiSurface): Promise<void>;
}

/** Surfaces by hash under `$XDG_CACHE_HOME/keelwerk/surfaces/`, with an index from connection to hash (section 16.9.1). */
export function surfaceCache(host: CliHost): SurfaceCache {
  const directory = `${cacheDir(host)}/surfaces`;
  const indexPath = `${directory}/index.json`;
  const readIndex = async (): Promise<Readonly<Record<string, string>>> => {
    const text = await host.files.readText(indexPath);
    if (text === undefined) {
      return {};
    }
    try {
      return JSON.parse(text) as Readonly<Record<string, string>>;
    } catch {
      return {};
    }
  };
  const fileFor = (hash: string) => `${directory}/${hash.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
  return {
    async hashFor(key) {
      return (await readIndex())[key];
    },
    async load(hash) {
      const text = await host.files.readText(fileFor(hash));
      if (text === undefined) {
        return undefined;
      }
      try {
        return JSON.parse(text) as ApiSurface;
      } catch {
        return undefined;
      }
    },
    async store(key, surface) {
      await host.files.writeText(fileFor(surface.hash), JSON.stringify(surface), 0o600);
      await host.files.writeText(
        indexPath,
        JSON.stringify({ ...(await readIndex()), [key]: surface.hash }),
        0o600,
      );
    },
  };
}
