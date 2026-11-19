/**
 * Turkish-aware text normalization shared by global search and the search UI.
 * The Turkish locale maps `İ` to `i` and `I` to `ı`; every whitespace run
 * (including note block separators) collapses to one space so multi-word
 * queries can be matched token by token.
 */
export function normalizeTr(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
}

/** Splits a user query into normalized tokens; empty input has no tokens. */
export function tokenizeTr(query: string): string[] {
  const normalized = normalizeTr(query);
  return normalized ? normalized.split(' ') : [];
}

/**
 * Order-independent token match: every token has to occur in the haystack.
 * Both sides are normalized first, so casing, Turkish dotted/dotless i and
 * whitespace differences never affect the result.
 */
export function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  const normalized = normalizeTr(haystack);
  return tokens.every((token) => normalized.includes(token));
}
