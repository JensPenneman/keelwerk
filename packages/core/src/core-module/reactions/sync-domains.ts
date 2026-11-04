import { defineReaction } from '../../dsl/define-reaction.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';
import { reconcileDomains } from './reconcile-domains.ts';

/**
 * Keeps `core.domain` in step with the host names of a new tenant (S-26): an inline reaction in
 * the unit that wrote the tenant; `syncDomainsOnChange` does the same when the names change.
 */
export const syncDomains: CoreLiteral['reactions']['syncDomains'] = defineReaction(coreBase, {
  on: 'core.tenant.created',
  timing: 'inline',
  react: (event, ctx) => reconcileDomains(ctx, event.stream.id, event.state),
});
