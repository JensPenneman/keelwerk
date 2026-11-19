import type { TrpcContext } from '../router/trpc-context.ts';

/**
 * The headers of a tRPC answer beyond tRPC's own: each cookie the cookie hint produced as
 * `Set-Cookie`, and, for a request of one call, the command id (`Keelwerk-Command-Id`), the ids of
 * the deferred effects (`Keelwerk-Effects`, comma-joined) and, for an accepted command,
 * `Preference-Applied: respond-async`. A batch of several calls has no one command to name.
 */
export function trpcResponseMeta(context: TrpcContext, calls: number): Headers {
  const headers = new Headers();
  for (const cookie of context.answer.setCookies) headers.append('set-cookie', cookie);
  if (calls !== 1) return headers;
  const { commandId, effects, accepted } = context.answer;
  if (commandId !== undefined) headers.set('keelwerk-command-id', commandId);
  if (effects !== undefined && effects.length > 0)
    headers.set('keelwerk-effects', effects.join(','));
  if (accepted === true) headers.set('preference-applied', 'respond-async');
  return headers;
}
