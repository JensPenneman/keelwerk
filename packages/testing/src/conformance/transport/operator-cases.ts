import { describe, expect, test } from 'vitest';
import { freshName } from './fresh-name.ts';
import { sendCall } from './send-call.ts';
import type { TransportTarget } from './transport-target.ts';

/** The operator socket (16.8.5): the host, not a transport, decides who is the operator; asserted through the invocation protocol. */
export function operatorCases(target: TransportTarget): void {
  describe('the operator socket', () => {
    // The operator socket opens a deployment-scope session, and the REST mount belongs to an app's
    // tenant scope, so the control actions are reachable through the invocation protocol only in
    // M1. The caller passes a target whose codec is the protocol's.
    const viaSocket: TransportTarget = { ...target, fetch: target.operatorFetch };
    const publicListener: TransportTarget = target;

    test('a request on the socket is the operator: it reads the backend with its configuration', async () => {
      const sent = await sendCall(viaSocket, {
        action: 'core.backend.query',
        input: {},
        caller: { host: 'localhost' },
      });
      expect(sent.decoded).toMatchObject({
        ok: true,
        value: { items: [{ name: 'conformance', config: target.backendConfig }] },
      });
    });

    test('the same read on the public listener is not the operator', async () => {
      const sent = await sendCall(publicListener, {
        action: 'core.backend.query',
        input: {},
        caller: { subject: freshName('ada') },
      });
      expect(sent.decoded).toEqual({ ok: false, kind: 'forbidden', code: 'core.forbidden' });
    });

    test('core.explain answers an operator on the socket', async () => {
      const sent = await sendCall(viaSocket, {
        action: 'core.explain',
        input: { mode: 'decision', ref: 'core.backend.query' },
        caller: { host: 'localhost' },
      });
      expect(sent.decoded.ok).toBe(true);
    });
  });
}
