import { expect, test } from 'vitest';
import { parseExtendedDiagnostics } from '../../../scripts/type-budgets/parse-extended-diagnostics.ts';

const captured = `Files:                   775
Lines:                 83911
Identifiers:           70254
Symbols:               61762
Types:                 10836
Instantiations:        52213
Memory used:          60328K
Memory allocs:        559282
Config time:          0.006s
BuildInfo read time:  0.000s
Parse time:           0.160s
Bind time:            0.000s
Check time:           0.028s
Emit time:            0.031s
Changes compute time: 0.029s
Total time:           0.254s
`;

test('reads files, instantiations and check time from a captured run', () => {
  expect(parseExtendedDiagnostics(captured)).toEqual({
    files: 775,
    instantiations: 52213,
    checkSeconds: 0.028,
    errors: [],
  });
});

test('collects error lines and ignores the statistics around them', () => {
  const error =
    "packages/m01/src/base.ts(1,69): error TS2883: The inferred type of 'm01' cannot be named.";
  const parsed = parseExtendedDiagnostics(`${error}\n${captured}`);
  expect(parsed.errors).toEqual([error]);
  expect(parsed.instantiations).toBe(52213);
});

test('refuses output without statistics', () => {
  expect(() => parseExtendedDiagnostics('error TS5083: Cannot read file.')).toThrow(/Files/);
});
