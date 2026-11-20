# @keelwerk/module-audit

Audit entries for every event of a tenant, with the request metadata of its receipt.

The module observes every tenant event (`observes: 'all'`, except its own entry events) and writes one
entry per event: the actor, the action, the command id, the event type and the request's transport.
The remote address and the user agent are sealed as personal values. Entries are read by operators who
entered the tenant and by the tenant's admins and owners. Erasure tombstones the entries of a subject,
and retention never purges an entry. An event that arrives after its subject was erased gets no entry.

Not recorded:

- events of deployment scope;
- events of process streams;
- events of backend scope (an entry is tenant-only);
- the transient records of the entities with `history: 'state'`, such as a logout, a session
  revocation or a reset token. A module that wants such an action audited emits a durable event on a
  chain entity, as `module-auth` does with `auth.credential.loggedIn`.
