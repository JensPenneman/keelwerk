function skipSpace(text: string, from: number): number {
  let at = from;
  while (at < text.length && /\s/.test(text.charAt(at))) at += 1;
  return at;
}

/** What follows the closing brace of `import { ... }`: `from '<path>'`, with where it ends. */
function fromClause(text: string, closing: number): { end: number; path: string } | undefined {
  const keyword = skipSpace(text, closing + 1);
  if (!text.startsWith('from', keyword)) return undefined;
  const open = skipSpace(text, keyword + 4);
  if (text.charAt(open) !== "'") return undefined;
  const close = text.indexOf("'", open + 1);
  if (close <= open + 1) return undefined;
  return { end: close + 1, path: text.slice(open + 1, close) };
}

/**
 * The relative import path of each named import in `text`, by local name. Reads the same text as
 * `import\s*\{([^}]*)\}\s*from\s*'([^']+)'` but by one scan: each candidate looks up the next
 * closing brace once, so a long run of unclosed imports costs linear time.
 */
export function importedPaths(text: string): Map<string, string> {
  const paths = new Map<string, string>();
  let closing = -2;
  let tailOf = -2;
  let tail: { end: number; path: string } | undefined;
  let at = text.indexOf('import');
  while (at >= 0) {
    const brace = skipSpace(text, at + 6);
    let next = at + 1;
    if (text.charAt(brace) === '{') {
      if (closing !== -1 && closing <= brace) closing = text.indexOf('}', brace + 1);
      if (closing < 0) break;
      if (tailOf !== closing) {
        tailOf = closing;
        tail = fromClause(text, closing);
      }
      if (tail !== undefined) {
        for (const specifier of text.slice(brace + 1, closing).split(',')) {
          const words = specifier.trim().split(/\s+/);
          const local = words.at(-1);
          if (local && words[0] !== 'type' && tail.path.startsWith('.'))
            paths.set(local, tail.path);
        }
        next = tail.end;
      }
    }
    at = text.indexOf('import', next);
  }
  return paths;
}
