import type { HttpContext } from './http-context.ts';

/** Web-standard `Request` and `Response` only: no host library type appears in the contract. */
export type HttpHandler = (request: Request, ctx: HttpContext) => Promise<Response>;
