/** What a retry policy leaves out (9.5.4): the attempts of a job without a count limit, and the largest delay of a series. `retryDelay` and `retryHorizonMs` both read it. */
export const defaultJobRetry: { readonly limit: number; readonly maxDelay: string } = {
  limit: 3,
  maxDelay: '10m',
};
