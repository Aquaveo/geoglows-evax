// Reach metadata lookup (LINKNO → lat/lon).
//
// Deferred for now per user direction 2026-05-22 ("scrap this for now").
// Until a lat/lon source is wired up, the lookup just returns null coords;
// the UI hides the map section when coords aren't present.
//
// When ready to re-introduce, see plans/02-architecture.md open Q #1
// (hyparquet vs. slimmed static asset vs. manual entry).

export interface ReachMetadata {
  riverId: number;
  lat: number | null;
  lon: number | null;
}

export async function getReachMetadata(riverId: number): Promise<ReachMetadata> {
  return { riverId, lat: null, lon: null };
}
