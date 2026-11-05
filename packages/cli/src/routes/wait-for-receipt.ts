import type { InvokeResponse } from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';
import { CliFailure } from '../context/cli-failure.ts';
import { localFailure } from '../context/local-failure.ts';

/** The first pause between two reads of the receipt; it doubles up to `longestPause`. */
const firstPause = 250;
const longestPause = 2000;

function interrupted(context: CliContext): void {
  if (context.signal.aborted) throw new CliFailure('interrupted', 'Interrupted.');
}

/** What `--wait` needs of the accepted answer and the request that produced it. */
export interface WaitInput {
  /** The answer of the accepted command. */
  readonly answer: Extract<InvokeResponse, { readonly ok: true }>;
  /** Seconds to wait; null waits until the receipt settles or the user interrupts. */
  readonly seconds: number | null;
  /** Sends the original request again, with the command id of the receipt. */
  readonly resend: () => Promise<InvokeResponse>;
  /** Prints the receipt a timeout leaves behind. */
  readonly show: (receipt: unknown) => void;
}

/**
 * `--wait[=<seconds>]` (sections 16.4.7 and 16.9.4): follows an accepted command's receipt with
 * `core.commandReceipt.get` on the same link and headers, every 250 ms and then twice as long up to
 * 2 s. When the receipt is `completed` or `failed` the original request is sent again with the same
 * command id, so the replay answers with the value or the stored error exactly as a synchronous
 * call would. `cli.receipt_not_found` when the receipt is gone, `cli.wait_timeout` (after printing the
 * receipt) past the limit, `cli.wait_unavailable` when the answer carries no receipt id.
 */
export async function waitForReceipt(
  context: CliContext,
  input: WaitInput,
): Promise<InvokeResponse> {
  const receiptId = (input.answer as { readonly receiptId?: unknown }).receiptId;
  if (typeof receiptId !== 'string') {
    throw localFailure(
      'unsupported',
      'cli.wait_unavailable',
      'The deployment gave no receipt id to wait on for this command.',
    );
  }
  const { host } = context;
  const deadline = input.seconds === null ? undefined : host.now() + input.seconds * 1000;
  let pause = firstPause;
  for (;;) {
    interrupted(context);
    const read: InvokeResponse = await context.client.invoke(
      'core.commandReceipt.get',
      { ids: [receiptId] },
      { signal: context.signal },
    );
    if (!read.ok) throw new CliFailure(read.error, read.error.message);
    const list = (read.value as { readonly list?: unknown } | null)?.list;
    const receipt = Array.isArray(list) ? (list[0] as { readonly status?: unknown }) : undefined;
    if (receipt === undefined) {
      throw localFailure('not_found', 'cli.receipt_not_found', 'The receipt does not exist.');
    }
    if (receipt.status === 'completed' || receipt.status === 'failed') return input.resend();
    const remaining = deadline === undefined ? undefined : deadline - host.now();
    if (remaining !== undefined && remaining <= 0) {
      input.show(receipt);
      throw localFailure(
        'unavailable',
        'cli.wait_timeout',
        'The command did not finish within the time given to --wait.',
      );
    }
    await host.sleep(remaining === undefined ? pause : Math.min(pause, remaining));
    pause = Math.min(pause * 2, longestPause);
  }
}
