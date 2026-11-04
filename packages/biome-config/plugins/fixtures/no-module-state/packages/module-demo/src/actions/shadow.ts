const names: readonly string[] = [];

function size(): number {
  return names.length;
}

export function shadow(): number {
  const names: string[] = [];
  names.push('x');
  return names.length + size();
}
