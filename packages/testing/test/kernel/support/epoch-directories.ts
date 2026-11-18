import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataAdapterFactory, Logger } from '@keelwerk/core';
import { afterEach, beforeEach } from 'vitest';
import { durablePgliteFactory } from '../../../src/harness/durable-pglite-factory.ts';
import type { IdentityOf } from '../../../src/harness/identity-of.ts';

/** A warning the logger kept. */
export interface Warning {
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

/** A logger that keeps the warnings: the bump of a scope is logged at warn with its reason. */
export function warnings(into: Warning[]): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, fields) => {
      into.push({ message, fields: { ...fields } });
    },
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}

/** What a test of a restore on directories works with. */
export interface EpochDirectories {
  /** PGlite with one directory per placement (`control`, `main`) under a directory of this test. */
  durableFactory(identity?: IdentityOf): DataAdapterFactory;
  /** Copies the placement directory aside as the backup. */
  backUp(): Promise<void>;
  /** Puts the backup back over the placement directory. */
  restore(): Promise<void>;
  /** Stops a runtime when the test ends. */
  track(stop: () => Promise<void>): void;
  /** Forgets the stops: the test stopped its runtime itself. */
  release(): void;
}

/** The directories and the cleanup of one test file: a fresh root for each test, runtimes stopped at its end. */
export function useEpochDirectories(): EpochDirectories {
  let root = '';
  const stops: (() => Promise<void>)[] = [];
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kw-epoch-'));
  });
  afterEach(async () => {
    await Promise.allSettled(stops.splice(0).map((stop) => stop()));
    await rm(root, { recursive: true, force: true });
  });
  return {
    durableFactory: (identity) =>
      durablePgliteFactory({
        dataDirOf: (placement) => join(root, placement.id),
        ...(identity === undefined ? {} : { identity }),
      }),
    backUp: () => cp(join(root, 'main'), join(root, 'backup'), { recursive: true }),
    restore: async () => {
      await rm(join(root, 'main'), { recursive: true, force: true });
      await cp(join(root, 'backup'), join(root, 'main'), { recursive: true });
    },
    track: (stop) => {
      stops.push(stop);
    },
    release: () => {
      stops.length = 0;
    },
  };
}
