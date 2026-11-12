import { kernelCommandId } from '@keelwerk/core';
import {
  lendCall,
  protocolCodec,
  sendCall,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { transportApp } from '@keelwerk/testing/fixtures';
import { describe, expect, test } from 'vitest';
import { httpHost } from '../src/index.ts';

describe('a command id the client chooses over HTTP', () => {
  test('in the form the kernel makes its own ids in is refused with core.command_id_reserved, and any other id passes', async () => {
    const running = await startTransportRuntime({ app: transportApp, host: httpHost() });
    try {
      const target = transportTargetOf(running, protocolCodec, []);
      const lend = (commandId: string) => sendCall(target, lendCall('ada', 'Dune', { commandId }));
      for (const id of [
        kernelCommandId('reaction', 'relay.echo', 'e1'),
        kernelCommandId('continuation', 'f1'),
      ]) {
        const refused = await lend(id);
        expect(refused.response.status).toBe(422);
        expect(refused.decoded).toMatchObject({
          ok: false,
          kind: 'validation',
          code: 'core.command_id_reserved',
        });
      }
      const other = await lend('my-own-id');
      expect(other.decoded).not.toMatchObject({ code: 'core.command_id_reserved' });
    } finally {
      await running.stop();
    }
  });
});
