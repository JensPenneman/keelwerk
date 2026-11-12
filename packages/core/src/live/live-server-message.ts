import type { WireError } from '../errors/wire-error.ts';
import type { InvokeResponse } from '../invoker/invoke-response.ts';
import type { CarrierEndReason } from './carrier-connection.ts';

/** What the host sends on `keelwerk.live.v1` (15.4.7); `presence` is M7. */
export type LiveServerMessage =
  | {
      readonly type: 'welcome';
      readonly principal: { readonly kind: string; readonly id: string | null };
      readonly heartbeatMs: number;
      readonly apiVersion: string;
      readonly surfaceHash: string;
      readonly protocol: number;
    }
  | { readonly type: 'data'; readonly id: string; readonly state?: string; readonly item: unknown }
  | { readonly type: 'head'; readonly id: string; readonly state: string }
  | {
      readonly type: 'reset';
      readonly id: string;
      readonly reason: 'overflow' | 'expired' | 'resync';
      readonly state?: string;
    }
  | { readonly type: 'gap'; readonly id: string; readonly missed?: number }
  | { readonly type: 'result'; readonly id: string; readonly response: InvokeResponse }
  | { readonly type: 'error'; readonly id?: string; readonly error: WireError }
  | {
      readonly type: 'notice';
      readonly notice: {
        readonly kind: 'deprecation';
        readonly apiVersion?: string;
        readonly action?: string;
        readonly at: string;
        readonly sunset?: string;
      };
    }
  | { readonly type: 'end'; readonly id: string; readonly reason: CarrierEndReason }
  | { readonly type: 'pong' };
