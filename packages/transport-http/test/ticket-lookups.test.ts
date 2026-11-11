import { describe, expect, it } from 'vitest';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const ticket = `kwst_${'a'.repeat(26)}_${'b'.repeat(52)}`;

describe('a ticket in the query of a request on a mounted path', () => {
  function mounted() {
    const made = setup();
    made.host.route(
      { app: 'library', transport: 'rest', prefix: '/api' },
      async () => new Response('mounted'),
    );
    return made;
  }
  const get = (query: string) => new Request(`https://library.example/api/books?${query}`);

  it('is spent by one lookup of its own beside the request', async () => {
    const { host, invoker } = mounted();
    const response = await host.fetch(get(`ticket=${ticket}`));
    expect(await response.text()).toBe('mounted');
    expect(invoker.opened.map((carrier) => carrier.ticket?.spendOnly ?? false)).toEqual([
      true,
      false,
    ]);
  });

  it('spends only the first of several well-formed ticket values', async () => {
    const { host, invoker } = mounted();
    const others = ['c', 'd', 'e'].map(
      (letter) => `kwst_${letter.repeat(26)}_${letter.repeat(52)}`,
    );
    const query = [ticket, ...others].map((value) => `ticket=${value}`).join('&');
    const response = await host.fetch(get(query));
    expect(await response.text()).toBe('mounted');
    expect(invoker.opened).toHaveLength(2);
    expect(invoker.opened.filter((carrier) => carrier.ticket?.spendOnly === true)).toHaveLength(1);
    expect(invoker.opened[0]?.ticket?.value).toBe(ticket);
  });

  it.each(['abc_def', 'Not-A-Ticket!', 'kwst_short_short', `${ticket}x1`.toUpperCase()])(
    'costs no lookup when %s is not of the form of a ticket',
    async (value) => {
      const { host, invoker } = mounted();
      const response = await host.fetch(get(`ticket=${encodeURIComponent(value)}`));
      expect(await response.text()).toBe('mounted');
      expect(invoker.opened).toHaveLength(1);
    },
  );
});
