import type { Clock, LiveTimers } from '@keelwerk/core';
import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import type { LoggedLine, TestApp, TransportRuntime } from '@keelwerk/testing';
import {
  protocolCodec,
  recordingLogger,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import type { HttpHostOptions } from '../../src/index.ts';
import { httpHost } from '../../src/index.ts';

/** The fixture app with the live module: `loans.loanEvents` exists once live is composed. */
export const streamApp = defineApp({ id: 'streams', modules: [live, library, loans] });

/** A started deployment of the stream app, with what its logger kept. */
export interface StreamRuntime {
  readonly runtime: TransportRuntime;
  readonly lines: LoggedLine[];
  readonly target: ReturnType<typeof transportTargetOf>;
  /** The origin of the first tenant. */
  readonly origin: string;
}

/** Starts the stream app with the host options given, on the in-memory adapter unless `pglite` is set. */
export async function startStreamRuntime(
  host: HttpHostOptions = {},
  over: {
    /** The app to serve instead of the stream app. */
    readonly app?: TestApp;
    readonly pglite?: boolean;
    readonly clock?: Clock;
    readonly timers?: LiveTimers;
    /** The API version each named tenant is pinned to (`acme` is the first tenant). */
    readonly tenantApiVersions?: Readonly<Record<string, string>>;
  } = {},
): Promise<StreamRuntime> {
  const lines: LoggedLine[] = [];
  const runtime = await startTransportRuntime({
    app: over.app ?? streamApp,
    host: httpHost(host),
    logger: recordingLogger(lines),
    ...(over.pglite === true ? { adapter: 'pglite' as const } : {}),
    ...(over.clock === undefined ? {} : { clock: over.clock }),
    ...(over.timers === undefined ? {} : { timers: over.timers }),
    ...(over.tenantApiVersions === undefined ? {} : { tenantApiVersions: over.tenantApiVersions }),
  });
  const target = transportTargetOf(runtime, protocolCodec, ['https://app.example.test'], true);
  const name = Object.keys(runtime.domains)[0] ?? 'acme';
  return { runtime, lines, target, origin: `https://${runtime.domains[name]}` };
}
