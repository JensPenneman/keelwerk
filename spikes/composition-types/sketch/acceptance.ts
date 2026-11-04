import { expectTypeOf } from 'vitest';
import type {
  DirectoryProfile,
  Portal,
  PortalCredential,
  PortalProfile,
} from '../../../docs/api-sketch.ts';
import type { ActionRef, AppActionTree } from '../src/app-action-tree.ts';
import type { Readable } from '../src/app-entities.ts';
import type { Id, SubjectId } from '../src/id.ts';
import type { AppClient } from './client.ts';

// The derived types the sketch documents in its comments, asserted against the spike's types.
expectTypeOf<PortalProfile>().toEqualTypeOf<{
  readonly id: Id<'accounts.profile'>;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly archivedAt?: Temporal.Instant | undefined;
  readonly version: number;
  readonly displayName: string;
  readonly email: string;
  readonly locale: string;
  readonly deactivatedAt?: Temporal.Instant | undefined;
  readonly lastLoginAt?: Temporal.Instant | undefined;
  readonly emailVerifiedAt?: Temporal.Instant | undefined;
}>();
expectTypeOf<DirectoryProfile>().not.toHaveProperty('lastLoginAt');
expectTypeOf<DirectoryProfile>().not.toHaveProperty('emailVerifiedAt');
expectTypeOf<PortalCredential>()
  .toHaveProperty('profileId')
  .toEqualTypeOf<Id<'accounts.profile'> | undefined>();
expectTypeOf<PortalCredential>().not.toHaveProperty('verifier');
expectTypeOf<PortalCredential['subject']>().toEqualTypeOf<SubjectId>();
expectTypeOf<Readable<Portal, 'accounts.profile'>['email']>().toEqualTypeOf<string | undefined>();
expectTypeOf<
  'accounts.profile.changePassword' | 'auth.sessionEvents' | 'app.health' | 'accounts.profile.watch'
>().toExtend<ActionRef<Portal>>();
expectTypeOf<
  AppActionTree<Portal>['accounts']['entities']['profile']['deactivate']['execution']
>().toEqualTypeOf<'either'>();

declare const client: AppClient<Portal>;
const receipt = await client.invoke(
  'accounts.profile.deactivate',
  { id: '' as Id<'accounts.profile'> },
  { prefer: 'async' },
);
expectTypeOf(receipt).toEqualTypeOf<{ readonly commandId: string; readonly status: 'accepted' }>();
const row = await client.invoke('accounts.profile.deactivate', {
  id: '' as Id<'accounts.profile'>,
});
expectTypeOf(row).toEqualTypeOf<Readable<Portal, 'accounts.profile'>>();
// @ts-expect-error a raw string is not a profile id
await client.invoke('accounts.profile.deactivate', { id: 'prof_1' });
