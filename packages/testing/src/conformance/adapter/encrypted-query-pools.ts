import { conformanceId } from '@keelwerk/data/conformance';

/** The value domains of the personal fields: equal under one normaliser and apart under another. */
const pools: Readonly<Record<string, readonly unknown[]>> = {
  exactName: ['Jens', 'jens', 'JENS', 'Jens ', 'é', 'é', 'ß', 'SS', ''],
  nfcName: ['Jens', 'jens', 'é', 'é', 'Å', 'Å', 'Å', ''],
  caselessName: ['Jens', 'JENS', 'jens', 'ﬁsh', 'FISH', 'fish', 'ǅ', 'ǆ', 'ß', 'SS'],
  mail: [
    'Jens@JensPenneman.com',
    'jens@jenspenneman.com',
    ' jens@jenspenneman.com ',
    'A@B.org',
    'a@b.ORG',
    'a@bücher.de',
    'a@BÜCHER.de',
    'a@xn--bcher-kva.de',
    'jenny@example.org',
    'plain',
  ],
  age: [0, 1, 2, 41, 42, -7],
  label: ['x', 'y', 'z'],
  note: ['n1', 'n2'],
};

/** What `startsWith` looks for: at least the prefix minimum of three characters. */
const needles = ['jen', 'JEN', 'a@b', 'A@B', 'a@bü', 'pla', 'xyz', 'jens@jenspenneman'];

/** The data subjects the random people belong to. */
const subjects = [901, 902, 903].map((n) => conformanceId(n));

/** The value domains, the prefix needles and the subjects of the random people. */
export const encryptedQueryPools: {
  readonly values: Readonly<Record<string, readonly unknown[]>>;
  readonly needles: readonly string[];
  readonly subjects: readonly string[];
} = { values: pools, needles, subjects };
