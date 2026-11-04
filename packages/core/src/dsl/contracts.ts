import { type Contract, defineContract } from './define-contract.ts';

/** The contracts the core declares. */
export interface Contracts {
  readonly live: Contract<'live', 'app'>;
  readonly blobs: Contract<'blobs', 'deployment'>;
  readonly httpHost: Contract<'httpHost', 'deployment'>;
}

/** The contracts the core declares (section 5.2). */
export const contracts: Contracts = {
  live: defineContract('live', 'app'),
  blobs: defineContract('blobs', 'deployment'),
  httpHost: defineContract('httpHost', 'deployment'),
};
