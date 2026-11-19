import { ClientError, type LiveLegEvent, liveLegEventsOf } from '@keelwerk/client';
import type {
  ApiSurface,
  CapabilitiesDocument,
  DeprecationNotice,
  InvokeResponse,
} from '@keelwerk/core';
import { version } from '../version.ts';
import { CliFailure } from './cli-failure.ts';
import type { CliHost, HostRequest } from './cli-host.ts';
import type { DeploymentLink, LinkOptions } from './deployment-link.ts';
import { deprecationOfHeaders } from './deprecation-of-headers.ts';
import { localFailure } from './local-failure.ts';
import type { ResolvedProfile } from './resolved-profile.ts';

const base = '/_keelwerk/v1';

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw localFailure(
      response.status >= 500 ? 'unavailable' : 'internal',
      'cli.bad_response',
      `The deployment answered ${response.status} with a body that is not JSON.`,
    );
  }
}

function isAbort(failure: unknown): boolean {
  return failure instanceof Error && failure.name === 'AbortError';
}

function failureOf(body: unknown, status: number): CliFailure {
  const error = (body as { readonly error?: InvokeResponseError } | null)?.error;
  if (error !== undefined && typeof error.code === 'string') {
    return new CliFailure(error, error.message);
  }
  return localFailure('unavailable', 'cli.bad_response', `The deployment answered ${status}.`);
}

/** A malformed stream event is a failure of the deployment's answer: the CLI renders it, not rethrows it. */
function cliFailureOf(failure: unknown): unknown {
  return failure instanceof ClientError
    ? new CliFailure(
        {
          kind: failure.kind,
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          requestId: failure.requestId ?? '',
        },
        failure.message,
      )
    : failure;
}

function renderedFailures(events: AsyncIterable<LiveLegEvent>): AsyncIterable<LiveLegEvent> {
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = events[Symbol.asyncIterator]();
      return {
        next: async () => {
          try {
            return await iterator.next();
          } catch (failure) {
            throw cliFailureOf(failure);
          }
        },
        return: async (value) =>
          iterator.return === undefined ? { done: true, value } : await iterator.return(value),
      };
    },
  };
}

type InvokeResponseError = Extract<InvokeResponse, { ok: false }>['error'];

/**
 * The invocation protocol over HTTP or the operator socket (section 16.8.2). Sends the credential,
 * the backend and tenant selectors, the client name and no `Origin`.
 */
export function createHttpLink(host: CliHost, profile: ResolvedProfile): DeploymentLink {
  const headers = (options: LinkOptions | undefined, extra: Readonly<Record<string, string>>) => ({
    accept: 'application/json',
    'keelwerk-client': `keelwerk-cli/${version}`,
    ...(profile.token !== undefined && { authorization: `Bearer ${profile.token}` }),
    ...(profile.backend !== undefined && { 'x-keelwerk-backend': profile.backend }),
    ...(profile.tenant !== undefined && { 'x-keelwerk-tenant': profile.tenant }),
    ...(options?.traceparent !== undefined && { traceparent: options.traceparent }),
    ...(options?.apiVersion !== undefined && { 'keelwerk-version': options.apiVersion }),
    ...extra,
  });
  const send = async (path: string, request: HostRequest): Promise<Response> => {
    try {
      return await (profile.socketPath !== undefined
        ? host.fetchSocket(profile.socketPath, `${base}${path}`, request)
        : host.fetch(`${(profile.url ?? '').replace(/\/+$/, '')}${base}${path}`, request));
    } catch (failure) {
      if (request.signal?.aborted === true || isAbort(failure)) {
        throw new CliFailure('interrupted', 'Interrupted.');
      }
      const reason = failure instanceof Error ? failure.message : String(failure);
      throw localFailure(
        'unavailable',
        'cli.unreachable',
        `The deployment is unreachable: ${reason}`,
      );
    }
  };
  const signalOf = (options: LinkOptions | undefined) =>
    options?.signal !== undefined ? { signal: options.signal } : {};
  return {
    async invoke(request, options) {
      const response = await send('/invoke', {
        method: 'POST',
        headers: headers(options, { 'content-type': 'application/json' }),
        body: JSON.stringify(request),
        ...signalOf(options),
      });
      const notice = deprecationOfHeaders(response.headers, request.action);
      if (notice !== undefined) options?.onDeprecation?.(notice);
      return (await readJson(response)) as InvokeResponse;
    },
    async surface(hash, options) {
      const response = await send('/surface', {
        method: 'GET',
        headers: headers(options, hash !== undefined ? { 'if-none-match': `"${hash}"` } : {}),
        ...signalOf(options),
      });
      if (response.status === 304) {
        return { modified: false };
      }
      const body = await readJson(response);
      if (!response.ok) {
        throw failureOf(body, response.status);
      }
      return { modified: true, surface: body as ApiSurface };
    },
    async subscribe(request, options) {
      const response = await send('/subscribe', {
        method: 'POST',
        headers: headers(options, {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        }),
        body: JSON.stringify({
          action: request.action,
          ...(request.input !== undefined && { input: request.input }),
          ...(request.after !== undefined && { after: request.after }),
        }),
        ...signalOf(options),
      });
      if (response.status !== 200 || response.body === null) {
        const body = await readJson(response).catch(() => undefined);
        const code = (body as { readonly error?: { readonly code?: unknown } } | undefined)?.error
          ?.code;
        if (response.status === 404 && code === 'core.not_found') {
          throw localFailure(
            'unavailable',
            'core.live_unavailable',
            'The deployment does not run the live module.',
          );
        }
        throw failureOf(body, response.status);
      }
      return renderedFailures(
        liveLegEventsOf(response.body, (data) => {
          try {
            options?.onDeprecation?.(JSON.parse(data) as DeprecationNotice);
          } catch {
            // A notice that cannot be read is dropped: it only warns.
          }
        }),
      );
    },
    async capabilities(options) {
      const response = await send('/capabilities', {
        method: 'GET',
        headers: headers(options, {}),
        ...signalOf(options),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw failureOf(body, response.status);
      }
      return body as CapabilitiesDocument;
    },
  };
}
