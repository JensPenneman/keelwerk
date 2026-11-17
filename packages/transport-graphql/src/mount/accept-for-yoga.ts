import { asksForEventStream } from '@keelwerk/core/http';

const JSON_TYPES = ['application/graphql-response+json', 'application/json'] as const;

/** Whether a range of an `Accept` names a media type: a `*` stands for either half. */
function names(range: string, type: string): boolean {
  const [main, sub] = range.split('/');
  const [typeMain, typeSub] = type.split('/');
  return (main === '*' || main === typeMain) && (sub === '*' || sub === typeSub);
}

/**
 * The JSON type Yoga itself answers an `Accept` with, by Yoga's own rule: `q` is ignored, a range
 * in a charset other than UTF-8 is skipped, the first range that names a JSON type decides, and a
 * range that names both (a wildcard) means `application/json`. A header that names none gets
 * `application/json` too.
 */
function jsonTypeFor(accept: string): string {
  for (const range of accept.replace(/\s/g, '').toLowerCase().split(',')) {
    const [type = '', ...parameters] = range.split(';');
    const charset = parameters.find((parameter) => parameter.includes('charset='));
    if (charset !== undefined && charset !== 'charset=utf-8') continue;
    const named = JSON_TYPES.filter((json) => names(type, json)).at(-1);
    if (named !== undefined) return named;
  }
  return 'application/json';
}

/**
 * The one `Accept` Yoga negotiates with. The host decides by `asksForEventStream` whether a request
 * takes a stream slot, and Yoga reads `Accept` differently (it ignores `q`, matches wildcards and
 * parameters), so it is never given a range the host read otherwise: a subscription gets exactly
 * `text/event-stream`; a request that did not ask for a stream gets exactly one JSON type, the one
 * Yoga chooses for the header as sent, so no wildcard lets Yoga answer it as a stream.
 */
export function acceptForYoga(request: Request, subscribes: boolean): string | undefined {
  if (subscribes) return 'text/event-stream';
  if (asksForEventStream(request)) return undefined;
  return jsonTypeFor(request.headers.get('accept') ?? '');
}
