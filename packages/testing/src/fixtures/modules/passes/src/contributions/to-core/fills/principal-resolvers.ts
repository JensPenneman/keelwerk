import {
  defineFill,
  errors,
  type Id,
  type Principal,
  type PrincipalResolution,
  type Scope,
  within,
} from '@keelwerk/core';
import { passesBase } from '../../../base.ts';
import { toCore } from '../contribution.ts';

const resolverId = 'passes.bearer';
const tokenPattern = /^pass\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function userOf(holder: string, id: string, scope: Scope): Principal {
  return {
    kind: 'user',
    subject: holder as Id<'subject'>,
    subjectRef: null,
    subjectAs: () => null,
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: {},
    roles: [],
    memberships: [],
    via: resolverId,
    ref: { resolver: resolverId, principalId: id },
  } as unknown as Principal;
}

/**
 * The bearer resolver of the live slices: `pass.<id>` is the user that holds the pass, until it is
 * revoked. A token in another format is another resolver's. The resolution names the pass row as
 * the row it depends on, the way auth's names the session and the credential (S-151).
 */
export const principalResolversFill = defineFill(
  within(passesBase, toCore),
  'principalResolvers',
  (own) => [
    {
      id: resolverId,
      describe: () => ({ scheme: 'bearer' as const }),
      *resolve(carrier, { scope }) {
        const token = carrier.token;
        const id = token === undefined ? undefined : tokenPattern.exec(token)?.[1];
        if (token === undefined || id === undefined) return null;
        const row = yield* own.load.passes.pass.byId(id as Id<'passes.pass'>);
        if (row === undefined || row.revokedAt !== undefined) {
          throw errors.unauthenticated('The pass was not accepted.');
        }
        const resolution: PrincipalResolution = {
          principal: userOf(row.holder, id, scope),
          cache: { key: token, entity: 'passes.pass', id },
        };
        return resolution;
      },
      *fromRef(ref, { scope }) {
        const row = yield* own.load.passes.pass.byId(ref.principalId as Id<'passes.pass'>);
        if (row === undefined || row.revokedAt !== undefined) return null;
        const resolution: PrincipalResolution = {
          principal: userOf(row.holder, ref.principalId, scope),
          cache: { key: ref.principalId, entity: 'passes.pass', id: ref.principalId },
        };
        return resolution;
      },
    },
  ],
);
