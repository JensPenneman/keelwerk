import { absentVerifier, defineFill, type Id, parseToken, setTimer, within } from '@keelwerk/core';
import { recordUse } from '../../../actions/record-use.ts';
import { repinKey } from '../../../actions/repin-key.ts';
import { apiKeysBase } from '../../../base.ts';
import { apiKeyPrefix } from '../../../lib/api-key-prefix.ts';
import { keyCacheKey } from '../../../lib/key-cache-key.ts';
import { keyPrincipal } from '../../../lib/key-principal.ts';
import { keyRefused } from '../../../lib/key-refused.ts';
import { keyResolverId } from '../../../lib/key-resolver-id.ts';
import { keyTransports } from '../../../lib/key-transports.ts';
import { lastUseDue } from '../../../lib/last-use-due.ts';
import { presentedKey } from '../../../lib/presented-key.ts';
import { toCore } from '../contribution.ts';

const description = 'An API key: a bearer token that stands for the person who created it.';

/**
 * The key resolver (17.2.4, G13): a bearer API key to the user principal of its owner, or to
 * nothing. A well-formed key of this module costs one load and one verification whether it exists,
 * is revoked, is expired or belongs to another tenant, and every such key answers the one refusal.
 * `fromRef` re-resolves the stored reference when queued work runs, when a stream ticket is redeemed
 * and when an open stream is revalidated, so a revoked or expired key stops there. A key bound to
 * transports is judged under the transport the work was accepted on: a redeemed ticket under its
 * carrier's, an asynchronous command under the one its receipt records. Work that names no transport
 * (an enqueue effect, a deferred invoke, a job whose receipt is gone) is refused for such a key.
 */
const keyResolverFill = defineFill(within(apiKeysBase, toCore), 'principalResolvers', (own) => [
  {
    id: keyResolverId,
    describe: () => ({ scheme: 'bearer', description }),
    *resolve(carrier, { scope, clock, retiredPinTarget }) {
      const token = presentedKey(carrier);
      if (token === undefined) return null;
      const parsed = parseToken(token);
      // A token of another prefix or format is another resolver's to accept or refuse.
      if (parsed === undefined || parsed.prefix !== apiKeyPrefix) return null;
      // A key belongs to one tenant: it is looked up where the carrier names, never across tenants (S-20).
      if (scope.level !== 'tenant') throw keyRefused();
      const row = yield* own.load.apiKeys.key.one({ where: { publicId: parsed.publicId } });
      const verified = yield* own.secrets.verify(token, row?.verifier ?? absentVerifier);
      const now = clock.now();
      const transports = row === undefined ? [] : keyTransports(row.scopes);
      if (
        !verified ||
        row === undefined ||
        row.revokedAt !== undefined ||
        (row.expiresAt !== undefined && Temporal.Instant.compare(row.expiresAt, now) <= 0) ||
        (transports.length > 0 && !transports.includes(carrier.transport))
      ) {
        throw keyRefused();
      }
      // A retired pin is served at its target at once; the keyed timer moves the stored pin.
      const target = row.apiVersion === undefined ? undefined : retiredPinTarget?.(row.apiVersion);
      const effects = [
        ...(lastUseDue(row.lastUsedAt, now)
          ? [
              setTimer({
                key: `api-keys.lastUse:${row.id}`,
                invoke: recordUse,
                input: { keyId: row.id },
                at: now,
              }),
            ]
          : []),
        ...(target === undefined
          ? []
          : [
              setTimer({
                key: `api-keys.repin:${row.id}`,
                invoke: repinKey,
                input: { keyId: row.id, apiVersion: target },
                at: now,
              }),
            ]),
      ];
      return {
        principal: keyPrincipal(row, scope, target ?? row.apiVersion),
        cache: { key: keyCacheKey(token), entity: 'api-keys.key', id: row.id },
        effects,
      };
    },
    *fromRef(ref, { scope, clock, transport }) {
      const row = yield* own.load.apiKeys.key.byId(ref.principalId as Id<'api-keys.key'>);
      if (
        row === undefined ||
        row.revokedAt !== undefined ||
        (row.expiresAt !== undefined && Temporal.Instant.compare(row.expiresAt, clock.now()) <= 0)
      ) {
        return null;
      }
      // Queued work and a redeemed ticket are judged under the transport that accepted them: a key
      // that names transports stands only on those, and a transport that is unknown (work queued by an
      // enqueue effect or a deferred invoke, or a job whose receipt is gone) is refused.
      const transports = keyTransports(row.scopes);
      if (transports.length > 0 && (transport === null || !transports.includes(transport))) {
        return null;
      }
      return {
        principal: keyPrincipal(row, scope, row.apiVersion),
        cache: { key: `api-keys.key:ref:${row.id}`, entity: 'api-keys.key', id: row.id },
      };
    },
  },
]);

/**
 * The same fill with `describe` beside its factory: the resolvers it yields as the security
 * schemes describe them, so a surface derived without a runtime needs no bound context (16.2).
 */
export const principalResolversFill: typeof keyResolverFill = {
  ...keyResolverFill,
  factory: Object.assign(keyResolverFill.factory, {
    describe: () => [{ id: keyResolverId, scheme: 'bearer' as const, description }],
  }),
};
