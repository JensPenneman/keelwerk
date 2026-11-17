# @keelwerk/core

The kernel of keelwerk: the DSL a module is written in, the invoker that runs actions, the storage
contracts and the implicit `core` module that every app mounts.

## Following the effects of a command

A command that requests an effect answers with the ids of the effects it requested. The principal
that sent the command follows them with two actions of the core module. Neither reads
`core.effect`: the entity is closed unless an app adds a rule of its own (see below), and these
two actions are the way the submitter sees its own effects.

- `core.effectStatus({ id })` is a query that answers the status of one effect.
- `core.effectStatusWatch({ ids })` is a subscription for one to a hundred effects. It sends the
  current status of each listed effect the caller requested, then `head`, then every later change
  of status. A reconnect with the last token never skips a change. The stream stays open after
  every effect has settled; the client closes it when it has what it needs.

Both show the same members and no others: the effect's `id`, its `type`, its `status`
(`requested`, `succeeded`, `failed` or `abandoned`), `requestedAt`, `runAt`, `deadline` and
`settledAt` where they exist, and, for a `failed` or `abandoned` effect, the `error` as its `kind`
and `code` only. The input, the continuation and its input, the output, the key, the attempts, the
ids of the events, the id of the command, the submitter reference and the message of an error are
never part of it. An outcome a client needs is stored by the module in an entity of its own.

An id over a transport is the typed form `eff_...`. The answer of a command lists plain UUIDs:
render them with `renderTypeId('eff', id)` before they are sent back, or let the typed client and
the command line do it.

### Who reads

An effect is read by the principal reference that requested it: the pair of resolver and principal
id the kernel stored when the decision requested the effect. Everything else answers exactly like
an effect that does not exist, so ids cannot be probed:

- another principal, another tenant and an unknown id give one and the same `not_found` for the
  query, and no item before `head` for the watch;
- a principal without a reference reads nothing;
- an effect requested without a submitter reads as nothing to everybody. These are the effects of
  continuations, timers and queued reactions, which run under a principal the kernel minted;
- the watch answers only the caller's own effects from a list, so a list of ids shows nothing about
  the ones that belong to somebody else.

An effect that an inline reaction of any module requests while the command runs carries the
submitter's reference too, although the reaction runs under its own module's service principal. The
submitter is shown that effect, its `type` and its error `code` included, and the module cannot opt
out.

Two sessions of one person are two references, because the principal id of a session is the id of
the session. An effect is followed from the session that sent the command (or from an API key, which
is a reference of its own), not from every session of the same user. The same rule holds for the
receipt of an accepted command. A stream token is bound to the caller's reference, so a token of
one submitter makes the stream of another start over (`reset`) and shows nothing of the first.

Who may call: any signed-in `user`, `service` or `operator` principal. An operator sees the effects
of its own commands only; the status view is not a read of `core.effect`. An anonymous caller is
refused.

### What an app's own rule over `core.effect` exposes

`principalResolver` and `principalId` are hidden fields. A rule of an app cannot name them in its
condition: composing the app refuses it (`unknownConditionFields`). A rule of its own over
`core.effect` can therefore be scoped only by the released members (`type`, `status`, `performer`
and the like), and it then shows every released member of the effects it selects: `input` (personal
members sealed, secrets as references), `commandId`, `eventIds`, `continuation`,
`continuationWith`, `key`, `attempts`, `output`, `outputDigest` and `error`, of every principal's
effects in the scope. Write such a rule only for an audience that may see all of it. For a submitter
that follows its own effects, the status view above is the way.
