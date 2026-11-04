import type { ApiSurface, Logger } from '@keelwerk/core';
import {
  type HttpHostDeps,
  type HttpHostInstance,
  type HttpHostOptions,
  httpHost,
} from '../../src/index.ts';
import { createFakeInvoker, type FakeInvoker } from './fake-invoker.ts';
import { fakeSurface } from './fake-surface.ts';
import { createRecordingTelemetry, type RecordingTelemetry } from './recording-telemetry.ts';

const silent: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silent,
};

export interface FakeHost {
  readonly host: HttpHostInstance;
  readonly invoker: FakeInvoker;
  readonly telemetry: RecordingTelemetry;
}

/** A host over a fake invoker, a fixed surface and a recording telemetry. */
export function createFakeHost(
  options: HttpHostOptions = {},
  setup: {
    readonly invoker?: FakeInvoker;
    readonly surface?: ApiSurface;
    readonly deps?: Partial<HttpHostDeps>;
  } = {},
): FakeHost {
  const invoker = setup.invoker ?? createFakeInvoker();
  const surface = setup.surface ?? fakeSurface([]);
  const telemetry = createRecordingTelemetry();
  const host = httpHost(options).create({
    surface: () => surface,
    log: silent,
    ...setup.deps,
    invoker,
    telemetry: telemetry.telemetry,
  });
  return { host, invoker, telemetry };
}
