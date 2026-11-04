/** The description of a response by status. */
export const statusTitles: Readonly<Record<number, string>> = {
  304: 'Not modified',
  400: 'Malformed request',
  401: 'Unauthenticated',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition failed',
  413: 'Payload too large',
  422: 'Validation failed or unsupported',
  429: 'Rate limited',
  500: 'Internal error',
  501: 'Not implemented',
  503: 'Unavailable',
};
