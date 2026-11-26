import {
  type AnsweredPrincipal,
  core,
  defineContribution,
  defineFill,
  defineModule,
  defineModuleBase,
  type ModuleBaseType,
  type ModuleType,
  type PrincipalResolver,
  type Scope,
  type UserPrincipal,
  within,
} from '@keelwerk/core';

const toCore = defineContribution(core, {});
const baseDef = defineModuleBase({ id: 'holder', version: '0.0.0', contributions: { toCore } });
interface HolderBase extends ModuleBaseType<typeof baseDef> {}
const holderBase: HolderBase = baseDef;

const header = 'x-holder';

function principalOf(profileId: string, scope: Scope): AnsweredPrincipal<UserPrincipal> {
  return {
    kind: 'user',
    subject: profileId as UserPrincipal['subject'],
    subjectRef: 'accounts.profile',
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: {},
    roles: [],
    memberships: [],
    via: 'holder.token',
    ref: { resolver: 'holder.token', principalId: profileId },
  };
}

/** An app's own resolver: it answers the profile its header names, and reads nothing from any store. */
const holderResolver = defineFill(
  within(holderBase, toCore),
  'principalResolvers',
  (): readonly PrincipalResolver[] => [
    {
      id: 'holder.token',
      describe: () => ({ scheme: 'apiKey', name: header }),
      // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
      *resolve(carrier, { scope }) {
        const profileId = carrier.headers?.[header];
        return profileId === undefined ? null : { principal: principalOf(profileId, scope) };
      },
      // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
      *fromRef(ref, { scope }) {
        return { principal: principalOf(ref.principalId, scope) };
      },
    },
  ],
);

const def = defineModule(holderBase, {
  contributes: { toCore: { extensionPoints: { principalResolvers: holderResolver } } },
});
export interface Holder extends ModuleType<typeof def> {}
/** A module of the tests whose resolver answers a user of the `accounts.profile` kind: the shape of an app's own resolver. */
export const holder: Holder = def;

/** The header that carries the id of the profile a request acts as. */
export const holderHeader = header;
