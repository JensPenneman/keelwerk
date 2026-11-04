import type { Meter } from '@keelwerk/core';
import type { HttpHostDeps } from './http-host-deps.ts';
import type { Lifecycle } from './lifecycle.ts';
import type { MountTable } from './mount-table.ts';
import type { TrustedProxies } from './trusted-proxies.ts';

/** What every part of one host shares; built once by `createHttpHost`. */
export interface HostContext {
  readonly deps: HttpHostDeps;
  readonly maxBodyBytes: number;
  readonly proxies: TrustedProxies;
  /** The mount table of each app. */
  readonly mounts: Map<string, MountTable>;
  /** One id per socket, so the requests of a keep-alive connection share a connection id. */
  readonly connectionIds: WeakMap<object, string>;
  readonly lifecycle: Lifecycle;
  readonly errorCounter: ReturnType<Meter['createCounter']>;
}
