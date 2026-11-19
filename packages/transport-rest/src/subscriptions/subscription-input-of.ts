import type { StateToken } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { decodeQueryString } from '../decode-query-string.ts';
import type { RestRoute } from '../rest-route.ts';

/**
 * The input and the resume token of a stream route (16.5.1, 15.4.8): the input members are the query
 * parameters, read like any `GET` (`decodeQueryString`: an unknown parameter is a `validation`
 * error); a subscription without input takes none. The token is the `Last-Event-ID` header when it is
 * not empty, else the query member `after` unless the input declares one itself (the generated
 * `watch` does), which then stays in the input. The token is passed on unchecked: the kernel refuses a
 * malformed one when it sets the subscription up. An input that is not a shape of members is
 * `core.unsupported`.
 */
export function subscriptionInputOf(
  route: RestRoute,
  request: Request,
): { readonly input: unknown; readonly after?: StateToken } {
  const { input } = route.action;
  if (input.kind === 'foreign') {
    throw coreError('core.unsupported', {
      message: 'This subscription cannot be opened over REST.',
    });
  }
  const params = new URL(request.url).searchParams;
  const declaresAfter = input.kind === 'shape' && Object.hasOwn(input.fields, 'after');
  const rest = new URLSearchParams(params);
  if (!declaresAfter) rest.delete('after');
  const decoded = decodeQueryString(route, rest);
  const header = request.headers.get('last-event-id');
  const queryAfter = declaresAfter ? null : params.get('after');
  const token = header !== null && header !== '' ? header : queryAfter;
  return {
    input: input.kind === 'void' ? undefined : decoded,
    ...(token !== null && token !== '' && { after: token as StateToken }),
  };
}
