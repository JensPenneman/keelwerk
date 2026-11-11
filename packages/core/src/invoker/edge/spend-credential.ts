import type { CredentialRedemption } from '../../edge/credential-redemption.ts';
import { errors } from '../../errors/errors.ts';
import { isKeelwerkError } from '../../errors/is-keelwerk-error.ts';
import { coreError } from '../../http/core-error.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ScopeTarget } from '../scope-target.ts';

/**
 * Spends a redemption in a writing unit of `target`: finds the row by id, then updates it at
 * `version` with `usedAt` and `updatedAt` set to now and the version raised by one. It writes no
 * change record (the use of a credential is not a fact of the domain). A row that is missing, spent
 * or at another version, and a lost race (the update is a conditional one, so of two requests with
 * one credential only one matches), is `unauthenticated` `core.ticket_invalid`; an entity that is
 * not in the app or has no `usedAt` is `internal`.
 */
export async function spendCredential(
  env: InvokerEnv,
  target: ScopeTarget,
  app: string,
  redemption: CredentialRedemption,
): Promise<void> {
  const entry = env.appOf(app).registry.entities.get(redemption.entity);
  if (entry === undefined || entry.descriptor.fields.usedAt === undefined) {
    throw errors.internal(`"${redemption.entity}" cannot hold a single-use credential.`);
  }
  const { descriptor } = entry;
  const now = env.options.clock.now();
  try {
    await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
      const row = await unit.rows.findOne(descriptor, {
        where: { op: 'eq', field: 'id', value: redemption.id },
      });
      if (
        row === undefined ||
        (row.usedAt !== undefined && row.usedAt !== null) ||
        Number(row.version) !== redemption.version
      ) {
        throw coreError('core.ticket_invalid');
      }
      await unit.rows.update(descriptor, [
        {
          id: redemption.id,
          expectedVersion: redemption.version,
          values: { ...row, usedAt: now, updatedAt: now, version: redemption.version + 1 },
        },
      ]);
    });
  } catch (error) {
    // Another request spent the credential between the read and the update.
    if (isKeelwerkError(error) && error.kind === 'conflict') throw coreError('core.ticket_invalid');
    throw error;
  }
}
