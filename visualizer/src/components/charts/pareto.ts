/** Points that no other point beats on both axes (lower is better on both). */
export function paretoFrontier<T extends { x: number; y: number }>(points: T[]): T[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const frontier: T[] = [];
  let best = Infinity;
  for (const point of sorted) {
    if (point.y < best) {
      frontier.push(point);
      best = point.y;
    }
  }
  return frontier;
}
