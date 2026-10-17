export function parsePageRanges(input: string, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('The PDF has no pages.');
  }

  const normalized = input.trim();
  if (!normalized) throw new Error('Enter at least one page or range.');

  const selected = new Set<number>();
  for (const part of normalized.split(',')) {
    const token = part.trim();
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) throw new Error(`Invalid page range: “${token}”.`);

    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > pageCount) {
      throw new Error(`Page range “${token}” is outside 1–${pageCount}.`);
    }
    for (let page = first; page <= last; page += 1) selected.add(page - 1);
  }
  return [...selected].sort((a, b) => a - b);
}
