import type { PrincipalResolver, Scope } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { principalResolversFill } from '../src/contributions/to-core/fills/principal-resolvers.ts';

const now = Temporal.Instant.from('2026-11-20T09:00:00Z');
const clock = { now: () => now };
const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const sessionId = 'sess-1';
const credentialId = 'cred-1';
const later = now.add({ hours: 1 });

interface SessionRow {
  readonly id: string;
  readonly subject: string;
  readonly credentialId: string;
  readonly idleExpiresAt: Temporal.Instant;
  readonly absoluteExpiresAt: Temporal.Instant;
  readonly revokedAt?: Temporal.Instant;
}

interface CredentialRow {
  readonly id: string;
  readonly revokedAt?: Temporal.Instant;
  readonly profileId?: string;
}

const liveSession: SessionRow = {
  id: sessionId,
  subject: 'subject-1',
  credentialId,
  idleExpiresAt: later,
  absoluteExpiresAt: later.add({ hours: 24 }),
};
const liveCredential: CredentialRow = { id: credentialId, profileId: 'profile-1' };

interface Request {
  readonly kind: 'load';
}

function stubOwn(session: SessionRow | undefined, credential: CredentialRow | undefined) {
  return {
    load: {
      auth: {
        session: {
          *byId(): Generator<Request, SessionRow | undefined, unknown> {
            yield { kind: 'load' };
            return session;
          },
        },
        credential: {
          *byId(): Generator<Request, CredentialRow | undefined, unknown> {
            yield { kind: 'load' };
            return credential;
          },
        },
      },
    },
  };
}

type Factory = (own: never) => readonly PrincipalResolver[];

/** Answers `fromRef` for a stored session and credential, driving the resolver's loads from the stub. */
function answer(
  session: SessionRow | undefined,
  credential: CredentialRow | undefined,
  ref: Record<string, string> = { principalId: sessionId, credentialId },
) {
  const [resolver] = (principalResolversFill.factory as unknown as Factory)(
    stubOwn(session, credential) as never,
  );
  const fromRef = resolver?.fromRef;
  if (fromRef === undefined) throw new Error('the session resolver has no fromRef');
  const generator = fromRef({ resolver: 'auth.session', sessionId, ...ref } as never, {
    scope: tenant,
    clock,
    transport: null,
  }) as unknown as Generator<Request, unknown, unknown>;
  let step = generator.next();
  while (step.done !== true) step = generator.next();
  return step.value;
}

describe('the session resolver re-resolves a stored reference (S-122)', () => {
  test('a live session answers the principal of the sign-in, with the cache dropped by its rows and by the profile', () => {
    expect(answer(liveSession, liveCredential)).toMatchObject({
      principal: {
        kind: 'user',
        subject: 'subject-1',
        subjectRef: 'accounts.profile',
        via: 'auth.session',
        ref: { resolver: 'auth.session', principalId: sessionId, credentialId, sessionId },
        expiresAt: later,
      },
      cache: {
        key: `auth.session:ref:${sessionId}`,
        drops: [
          { entity: 'auth.session', id: sessionId },
          { entity: 'auth.credential', id: credentialId },
          { entity: 'accounts.profile', id: 'profile-1' },
        ],
      },
    });
  });

  test('a session that stands for no person answers null', () => {
    expect(answer(undefined, liveCredential)).toBeNull();
    expect(answer({ ...liveSession, revokedAt: now }, liveCredential)).toBeNull();
    expect(answer(liveSession, undefined)).toBeNull();
    expect(answer(liveSession, { ...liveCredential, revokedAt: now })).toBeNull();
  });

  test('an idle or an absolute expiry at this instant answers null', () => {
    expect(answer({ ...liveSession, idleExpiresAt: now }, liveCredential)).toBeNull();
    expect(answer({ ...liveSession, absoluteExpiresAt: now }, liveCredential)).toBeNull();
  });

  test("a reference whose credential is not the session row's answers null", () => {
    expect(
      answer(liveSession, liveCredential, { principalId: sessionId, credentialId: 'cred-2' }),
    ).toBeNull();
  });

  test('a live session answers no effect and no cookie', () => {
    const resolution = answer(liveSession, liveCredential);
    expect(resolution).not.toHaveProperty('effects');
    expect(resolution).not.toHaveProperty('renewCookie');
  });
});
