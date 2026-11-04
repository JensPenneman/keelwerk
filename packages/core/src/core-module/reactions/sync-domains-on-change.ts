import { defineReaction } from '../../dsl/define-reaction.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';
import { reconcileDomains } from './reconcile-domains.ts';

/** The reaction of `syncDomains` for `core.tenant.changed`: a tenant that gains or loses host names (S-26). */
export const syncDomainsOnChange: CoreLiteral['reactions']['syncDomainsOnChange'] = defineReaction(
  coreBase,
  {
    on: 'core.tenant.changed',
    timing: 'inline',
    react: (event, ctx) => reconcileDomains(ctx, event.stream.id, event.state),
  },
);
