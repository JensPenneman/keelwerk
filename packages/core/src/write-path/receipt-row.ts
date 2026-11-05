import type { RequestInfo } from '../invoker/request-info.ts';
import type { Principal } from '../principals/principal.ts';
import type { Receipt } from '../storage/receipt.ts';

/** How long a receipt answers a retry, unless the action says otherwise (section 7.5). */
const defaultWindowMs = 24 * 60 * 60 * 1000;

/** What a pending receipt is built from. */
export interface ReceiptRowInput {
  readonly commandId: string;
  readonly action: string;
  readonly fingerprint: string;
  readonly principal: Principal;
  readonly apiVersion: string;
  readonly request: RequestInfo;
  readonly client?: { readonly id: string; readonly seq: number };
  readonly now: Temporal.Instant;
  /** The action's idempotency window in milliseconds; default 24 hours. */
  readonly windowMs?: number;
}

/**
 * The `core.commandReceipt` row of a command that has just begun (section 15.1.7): `pending`, no
 * outcome. The store derives the row id from the scope and the command id (`commandReceiptId`);
 * these fields are final from M1.
 */
export function receiptRow(input: ReceiptRowInput): Receipt {
  return {
    commandId: input.commandId,
    action: input.action,
    fingerprint: input.fingerprint,
    principal: input.principal.ref,
    principalResolver: input.principal.ref?.resolver ?? null,
    principalId: input.principal.ref?.principalId ?? null,
    status: 'pending',
    outcome: null,
    apiVersion: input.apiVersion,
    request: {
      transport: input.request.transport,
      remoteAddress: input.request.connection?.remote.address ?? null,
      userAgent: input.request.userAgent ?? null,
    },
    clientId: input.client?.id ?? null,
    clientSeq: input.client?.seq ?? null,
    expiresAt: input.now.add({ milliseconds: input.windowMs ?? defaultWindowMs }),
  };
}
