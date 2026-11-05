import { decodeAnswer } from './decode-answer.ts';
import { originOf } from './origin-of.ts';
import { requestHeaders } from './request-headers.ts';
import { responseRecord } from './response-record.ts';
import type { TransportCodec } from './transport-codec.ts';

/** The invocation protocol (16.8.2): `POST /_keelwerk/v1/invoke` with an `InvokeRequest`. */
export const protocolCodec: TransportCodec = {
  name: 'invocation protocol',
  endpoint: '/_keelwerk/v1/invoke',
  subscribePath: '/_keelwerk/v1/subscribe',
  async send(target, call) {
    const caller = call.caller ?? {};
    const headers = requestHeaders(caller);
    headers.set('content-type', 'application/json');
    const input =
      call.ifVersion === undefined ? call.input : { ...call.input, ifVersion: call.ifVersion };
    const response = await target.fetch(
      new Request(`${originOf(target, caller)}${caller.pathPrefix ?? ''}/_keelwerk/v1/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: call.action,
          ...(input === undefined ? {} : { input }),
          ...(call.commandId === undefined ? {} : { commandId: call.commandId }),
          ...(call.prefer === undefined ? {} : { prefer: call.prefer }),
        }),
      }),
    );
    return decodeAnswer(response, true);
  },
  receiptLocationOf: () => null,
  expectedReceiptLocation: () => null,
  rowVersionOf(sent) {
    const value = responseRecord(sent.decoded.ok ? sent.decoded.value : undefined);
    return typeof value?.version === 'number' ? value.version : null;
  },
  commandIdOf(sent) {
    const id = responseRecord(sent.body)?.commandId;
    return typeof id === 'string' ? id : sent.response.headers.get('keelwerk-command-id');
  },
  reportsChosenCommandId: false,
  isReplay: (sent) => responseRecord(sent.body)?.replayed === true,
  configurableCors: false,
  marksReplays: false,
};
