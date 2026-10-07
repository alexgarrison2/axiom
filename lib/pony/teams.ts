/** NHL alignment (2026-27): division and conference by tricode, for the Pony Score filters. */
export const DIVISIONS: Record<string, string[]> = {
    Atlantic: ['BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TBL', 'TOR'],
    Metropolitan: ['CAR', 'CBJ', 'NJD', 'NYI', 'NYR', 'PHI', 'PIT', 'WSH'],
    Central: ['CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'UTA', 'WPG'],
    Pacific: ['ANA', 'CGY', 'EDM', 'LAK', 'SJS', 'SEA', 'VAN', 'VGK'],
};
export const CONFERENCE: Record<string, 'East' | 'West'> = { Atlantic: 'East', Metropolitan: 'East', Central: 'West', Pacific: 'West' };
export const ALL_TEAMS = Object.values(DIVISIONS).flat().sort();

const DIV_OF = new Map(Object.entries(DIVISIONS).flatMap(([d, ts]) => ts.map(t => [t, d] as const)));
/** Arizona's last season (2023-24) sat in the Central too. */
export const divisionOf = (tri: string) => DIV_OF.get(tri) ?? (tri === 'ARI' ? 'Central' : null);
export const conferenceOf = (tri: string) => {
    const d = divisionOf(tri);
    return d ? CONFERENCE[d] : null;
};
