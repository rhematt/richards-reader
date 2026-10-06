// The ownership map is the boundary between authoritative PDF objects and
// projections. A glyph belongs to at most one specialist/source region.
export function reconcileRegions(regions, runs) {
  const owner = new Map();
  for (const region of regions) {
    region.sourceObjectIds = [...new Set(region.sourceObjectIds || [])].filter(id => {
      if (owner.has(id)) return false;
      owner.set(id, region.id);
      return true;
    });
  }
  return { regions, proseRuns: runs.filter(run => !owner.has(run.id)), owner };
}
