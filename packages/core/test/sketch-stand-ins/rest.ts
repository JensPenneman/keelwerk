import { contracts } from '../../src/dsl/contracts.ts';
import { defineTransportModule } from '../../src/dsl/define-transport-module.ts';
import { stubTransport } from './stub-transport.ts';

/** Stand-in for @keelwerk/transport-rest: a transport module that requires the HTTP host. */
export const rest = defineTransportModule({
  id: 'rest',
  requires: [contracts.httpHost],
  transport: stubTransport('rest'),
});
