import type { HostFetchOptions } from '@keelwerk/core';

/** The options of the suite's socket hook: those of `host.fetch`, and whether the client answers a server ping by itself (default true). */
export type ConnectOptions = HostFetchOptions & { readonly answerPings?: boolean };
