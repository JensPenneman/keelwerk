import type { DecideContext } from '../../contexts/decide-context.ts';
import { errors } from '../../errors/errors.ts';
import type { Draft } from '../../protocol/draft.ts';
import type { Gen } from '../../protocol/gen.ts';
import type { CoreBase } from '../core-base-type.ts';
import { normalizeHost } from '../normalize-host.ts';

/** The part of a tenant row the reconciliation reads. */
interface TenantDomains {
  readonly backendId: string;
  readonly domains: readonly string[];
}

/**
 * The drafts that make the `core.domain` rows of one tenant equal its host names (S-26): a name
 * without a row gets a new row, a row whose name the tenant lost
 * is archived, and a name another tenant holds is `conflict`. Host names are normalised as the edge does (lower case, no port, no trailing dot) and must be valid host names.
 */
export function* reconcileDomains(
  ctx: DecideContext<CoreBase>,
  tenantId: string,
  tenant: TenantDomains,
): Gen<readonly Draft[]> {
  const wanted = new Set(tenant.domains.map((name) => normalizeHost(name)));
  const held = yield* ctx.load.core.domain.many({ where: { tenantId: tenantId as never } });
  const drafts: Draft[] = [];
  for (const row of held) {
    if (!wanted.has(row.hostname)) drafts.push(ctx.write.core.domain.archive(row));
  }
  const heldNames = new Set(held.map((row) => row.hostname));
  for (const hostname of wanted) {
    if (heldNames.has(hostname)) continue;
    const other = yield* ctx.load.core.domain.one({ where: { hostname } });
    if (other !== undefined) {
      throw errors.conflict(`The host name ${hostname} belongs to another tenant.`);
    }
    drafts.push(
      ctx.write.core.domain.create({
        hostname,
        backendId: tenant.backendId as never,
        tenantId: tenantId as never,
      }),
    );
  }
  return drafts;
}
