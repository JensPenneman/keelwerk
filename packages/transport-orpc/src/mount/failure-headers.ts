import type { KeelwerkError } from '@keelwerk/core';
import { wwwAuthenticateValue } from '@keelwerk/core/http';

/** `Retry-After` of a rate limit or an unavailable service and `WWW-Authenticate` of a refused identity (section 16.4.6). */
export function failureHeaders(headers: Headers, error: KeelwerkError, status: number): void {
  if (error.retryAfter !== undefined && (status === 429 || status === 503)) {
    if (error.code !== 'core.quota_exceeded') {
      headers.set('retry-after', String(Math.ceil(error.retryAfter)));
    }
  }
  if (status === 401) headers.set('www-authenticate', wwwAuthenticateValue);
}
