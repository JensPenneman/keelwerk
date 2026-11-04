import { contracts } from '../../src/dsl/contracts.ts';
import { defineTransportModule } from '../../src/dsl/define-transport-module.ts';
import { stubTransport } from './stub-transport.ts';

/** Stand-in for @keelwerk/transport-graphql. */
export const graphql = defineTransportModule({
  id: 'graphql',
  requires: [contracts.httpHost],
  transport: stubTransport('graphql'),
});
