export function forms(): number {
  const a = globalThis.Date.now(); // expect: plugin/pure-parts
  const b = globalThis.fetch('https://example.com'); // expect: plugin/pure-parts
  const c = globalThis.crypto.randomUUID(); // expect: plugin/pure-parts
  const d = Date(); // expect: plugin/pure-parts
  const now = Date.now; // expect: plugin/pure-parts
  const clock = Temporal.Now; // expect: plugin/pure-parts
  const e = Temporal.Now['instant'](); // expect: plugin/pure-parts, lint/complexity/useLiteralKeys
  return [a, b, c, d, now(), clock.instant(), e].length;
}
