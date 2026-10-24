/** Standard RRF constant: dampens the gap between rank 1 and rank 2. */
const RRF_K = 60;

/**
 * Reciprocal rank fusion: each list votes 1 / (60 + rank) for each item. It combines
 * rankings without needing their scores to be on the same scale, which vector similarity
 * and full-text rank are not.
 */
export function reciprocalRankFusion<T extends { id: number }>(lists: T[][], k = RRF_K): { item: T; score: number }[] {
  const scores = new Map<number, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const entry = scores.get(item.id) ?? { item, score: 0 };
      entry.score += 1 / (k + rank + 1);
      scores.set(item.id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

/**
 * Fuses the rankings, then scales each item's fused score by its source weight, so a current
 * rule outranks an old budget or a bill that matched the same words.
 */
export function weightedFusion<T extends { id: number; weight?: number }>(lists: T[][]): { item: T; score: number }[] {
  return reciprocalRankFusion(lists)
    .map(({ item, score }) => ({ item, score: score * (item.weight ?? 1) }))
    .sort((a, b) => b.score - a.score);
}
