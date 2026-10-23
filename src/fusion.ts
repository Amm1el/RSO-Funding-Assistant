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
