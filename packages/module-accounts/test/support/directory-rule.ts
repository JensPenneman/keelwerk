/**
 * The rule an application adds to give a directory. The README of the module shows this text and
 * a case compares the two. The application's own module is `readers`; the kernel takes a membership
 * of the kind `readers.directory` only from that module's fills.
 */
const directoryRule = {
  // rule-start
  id: 'readers.profile.directory',
  module: 'readers',
  effect: 'allow',
  subject: { module: 'accounts', entity: 'profile' },
  actions: ['read', 'search'],
  principal: 'user',
  where: (ctx: { principal: { memberships: readonly { kind: string }[] } }) =>
    ctx.principal.memberships.some((membership) => membership.kind === 'readers.directory'),
  fields: [],
  reason: 'The application lets the readers of its directory browse people by name.',
  disabled: false,
  // rule-end
} as const;

export { directoryRule };
