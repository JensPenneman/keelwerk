import { decodeAnswer } from './decode-answer.ts';
import { originOf } from './origin-of.ts';
import { readEventStream } from './read-event-stream.ts';
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
  async subscribe(target, call) {
    const caller = call.caller ?? {};
    const headers = requestHeaders(caller);
    headers.set('accept', 'text/event-stream');
    if (call.lastEventId !== undefined) headers.set('last-event-id', call.lastEventId);
    const base = `${originOf(target, caller)}${caller.pathPrefix ?? ''}/_keelwerk/v1/subscribe`;
    const options = call.remoteAddress === undefined ? {} : { remoteAddress: call.remoteAddress };
    if (call.method === 'POST') {
      headers.set('content-type', 'application/json');
      const response = await target.fetch(
        new Request(base, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: call.action,
            ...(call.input === undefined ? {} : { input: call.input }),
            ...(call.after === undefined ? {} : { after: call.after }),
          }),
        }),
        options,
      );
      return readEventStream(response);
    }
    const query = new URLSearchParams({ action: call.action });
    if (call.input !== undefined) query.set('input', JSON.stringify(call.input));
    if (call.after !== undefined) query.set('after', call.after);
    if (call.ticket !== undefined) query.set('ticket', call.ticket);
    return readEventStream(
      await target.fetch(new Request(`${base}?${query}`, { headers }), options),
    );
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
