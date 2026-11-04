import process from 'node:process';
import { expect, test } from 'vitest';
import { runNode } from './run-node.ts';

const script = `
import { domainToASCII } from 'node:url';
const email = (value) => {
  const at = value.trim().normalize('NFC').lastIndexOf('@');
  const local = value.trim().normalize('NFC').slice(0, at);
  const domain = domainToASCII(value.trim().normalize('NFC').slice(at + 1));
  return (local + '@' + domain).toLowerCase();
};
console.log(JSON.stringify({
  unicode: process.versions.unicode,
  nfc: 'e\\u0301'.normalize('NFC') === '\\u00e9',
  nfkc: ['\\ufb01', '\\u2460', '\\uff21', '\\u00b2'].map((s) => s.normalize('NFKC')),
  nfkcLower: '\\u1e9e\\u0130'.normalize('NFKC').toLowerCase(),
  idna: [domainToASCII('B\\u00fccher.example'), domainToASCII('JensPenneman.com'), domainToASCII('\\u4f8b\\u3048.jp')],
  email: [email('Jens@JensPenneman.com'), email(' jens@jenspenneman.com '), email('A@B\\u00fccher.Example')],
}));
`;

test('the Unicode version and the normaliser samples', () => {
  const run = runNode(['--input-type=module', '--eval', script]);
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  const out = JSON.parse(run.stdout) as {
    unicode: string;
    nfc: boolean;
    nfkc: string[];
    nfkcLower: string;
    idna: string[];
    email: string[];
  };
  expect(out.unicode).toMatch(/^\d+\.\d+$/);
  expect(out.nfc).toBe(true);
  expect(out.nfkc).toEqual(['fi', '1', 'A', '2']);
  expect(out.nfkcLower).toBe('\u00dfi\u0307');
  expect(out.idna).toEqual(['xn--bcher-kva.example', 'jenspenneman.com', 'xn--r8jz45g.jp']);
  expect(out.email).toEqual([
    'jens@jenspenneman.com',
    'jens@jenspenneman.com',
    'a@xn--bcher-kva.example',
  ]);
  process.stdout.write(`unicode ${out.unicode}\n`);
});
