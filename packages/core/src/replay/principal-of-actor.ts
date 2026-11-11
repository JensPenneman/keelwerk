import type { ActorRef } from '../principals/actor-ref.ts';
import type { AnonymousPrincipal } from '../principals/anonymous-principal.ts';
import type { OperatorPrincipal } from '../principals/operator-principal.ts';
import type { Principal } from '../principals/principal.ts';
import type { ServicePrincipal } from '../principals/service-principal.ts';
import type { SystemPrincipal } from '../principals/system-principal.ts';
import type { UserPrincipal } from '../principals/user-principal.ts';
import { moduleResolver } from '../reactions/module-resolver.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { Scope } from '../storage/scope.ts';

const moduleSuffix = '.system';

/**
 * A principal standing for the actor of a recorded event. It carries the identity the envelope
 * keeps and nothing else (no roles, claims or memberships), so a decision whose authorization
 * depends on those is re-decided with the principal the caller passes instead.
 */
export function principalOfActor(actor: ActorRef, scope: Scope): Principal {
  const base = {
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
    claims: {},
    roles: [],
    memberships: [],
    via: actor.via,
    ref: null,
  };
  const id = actor.id ?? '';
  switch (actor.kind) {
    case 'user': {
      const user: UserPrincipal = {
        ...base,
        kind: 'user',
        subject: id as UserPrincipal['subject'],
        subjectRef: null,
        subjectAs: () => null,
      };
      return user;
    }
    case 'service': {
      if (actor.via === moduleResolver && id.endsWith(moduleSuffix)) {
        return moduleServicePrincipal(id.slice(0, -moduleSuffix.length), base);
      }
      const service: ServicePrincipal = {
        ...base,
        kind: 'service',
        id: id as ServicePrincipal['id'],
        idAs: () => null,
      };
      return service;
    }
    case 'operator': {
      const operator: OperatorPrincipal = {
        ...base,
        kind: 'operator',
        id: id as OperatorPrincipal['id'],
      };
      return operator;
    }
    case 'system': {
      const system: SystemPrincipal = { ...base, kind: 'system', reason: 'replay' };
      return system;
    }
    case 'anonymous': {
      const anonymous: AnonymousPrincipal = { ...base, kind: 'anonymous' };
      return anonymous;
    }
  }
}
