import type { Carrier } from './carrier.ts';
import type { InvocationSession } from './invocation-session.ts';

/** One call of an action through the pipeline (section 9.2). */
export interface Invocation<I> {
  /** 'accounts.profile.deactivate'. */
  readonly action: string;
  readonly input: I;
  readonly carrier: Carrier;
  /** When present, scope and principal resolution reuse it. */
  readonly session?: InvocationSession;
  readonly requestId: string;
  readonly commandId?: string;
  readonly prefer?: 'sync' | 'async';
  readonly sync?: {
    readonly clientId: string;
    readonly clientSeq: number;
    readonly baseVersions: Readonly<Record<string, number>>;
    readonly hlc: string;
  };
  readonly traceparent?: string;
  readonly signal: AbortSignal;
}
