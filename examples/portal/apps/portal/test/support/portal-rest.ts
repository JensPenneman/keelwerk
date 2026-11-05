/** What a REST call answers, decoded. */
export interface Answered {
  readonly status: number;
  readonly headers: Headers;
  readonly cookies: readonly string[];
  readonly body: Readonly<Record<string, unknown>>;
}

/** How a call is made. */
export interface RestCall {
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** The headers a browser adds on its own to a same-origin request. */
  readonly browser?: boolean;
}

/** A REST client of one tenant: every call goes through the host's dispatch on the tenant's domain. */
export interface PortalRest {
  readonly domain: string;
  send(method: string, path: string, call?: RestCall): Promise<Answered>;
}

/** The REST client of a tenant over a host dispatch. */
export function portalRest(
  dispatch: (request: Request) => Promise<Response>,
  domain: string,
): PortalRest {
  return {
    domain,
    async send(method, path, call = {}) {
      const headers = new Headers(call.headers);
      if (call.browser === true) {
        headers.set('origin', `https://${domain}`);
        headers.set('sec-fetch-site', 'same-origin');
      }
      const hasBody = call.body !== undefined;
      if (hasBody) headers.set('content-type', 'application/json');
      const response = await dispatch(
        new Request(`https://${domain}${path}`, {
          method,
          headers,
          ...(hasBody && { body: JSON.stringify(call.body) }),
        }),
      );
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        cookies: response.headers.getSetCookie(),
        body: text === '' ? {} : (JSON.parse(text) as Readonly<Record<string, unknown>>),
      };
    },
  };
}
