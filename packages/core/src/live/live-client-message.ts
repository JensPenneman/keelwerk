import type { InvokeRequest } from '../invoker/invoke-request.ts';

/** What a client sends on `keelwerk.live.v1` (15.4.7); `presence` is M7 and answered not_implemented. */
export type LiveClientMessage =
  | {
      readonly type: 'hello';
      readonly token?: string;
      readonly backend?: string;
      readonly tenant?: string;
      readonly apiVersion?: string;
      readonly traceparent?: string;
    }
  | {
      readonly type: 'subscribe';
      readonly id: string;
      readonly action: string;
      readonly input?: unknown;
      readonly after?: string;
    }
  | { readonly type: 'unsubscribe'; readonly id: string }
  | { readonly type: 'invoke'; readonly id: string; readonly request: InvokeRequest }
  | { readonly type: 'ping' };
