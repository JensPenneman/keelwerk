import type { RequestInfo } from '../invoker/request-info.ts';
import type { Principal } from '../principals/principal.ts';

/** Who asks for a control command and under which command id (S-109): the session's principal, or the runtime's own operator. */
export interface ControlRun {
  readonly principal: Principal;
  /** The client's command id: the receipt that makes a retry answer the same id. */
  readonly commandId?: string;
  readonly request?: RequestInfo;
  /** The API version the outcome is expressed in; default: the core's oldest. */
  readonly apiVersion?: string;
  readonly signal?: AbortSignal;
}
