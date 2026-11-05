import type { ApiSurface, Contract, Invoker, Logger, Telemetry } from '@keelwerk/core';

/** What the entry of `httpHost(...)` is given when it builds the host (section 16.3.3). */
export interface HostDeps {
  readonly invoker: Invoker;
  surface(appId: string, version?: string): ApiSurface;
  readonly telemetry: Telemetry;
  readonly log: Logger;
  readonly operator?: { readonly socket?: string };
  readonly development?: boolean;
}

/** The running host an entry builds. */
export interface BuiltHost {
  listen(): Promise<{ readonly port?: number; readonly operatorSocket?: string }>;
  stop(deadlineMs: number): Promise<void>;
}

/** The infrastructure entry of the HTTP host, seen through the members the CLI uses. */
export interface HttpHostEntryView {
  readonly kind: 'httpHost';
  readonly provides: readonly Contract<string, 'deployment'>[];
  create(deps: HostDeps): BuiltHost;
}

/** The deployment's HTTP host entry, when it lists one. */
export function httpHostEntryOf(infrastructure: readonly unknown[]): HttpHostEntryView | undefined {
  return infrastructure.find(
    (entry): entry is HttpHostEntryView =>
      typeof entry === 'object' &&
      entry !== null &&
      Reflect.get(entry, 'kind') === 'httpHost' &&
      typeof Reflect.get(entry, 'create') === 'function',
  );
}
