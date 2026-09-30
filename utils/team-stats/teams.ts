import { TEAM_NAMES, teamColor } from '../../components/ui/team-color';
import type { Division, TeamMeta } from './types';

export const DIVISION_OF: Record<string, Division> = {
    BOS: 'Atlantic', BUF: 'Atlantic', DET: 'Atlantic', FLA: 'Atlantic',
    MTL: 'Atlantic', OTT: 'Atlantic', TBL: 'Atlantic', TOR: 'Atlantic',
    CAR: 'Metro', CBJ: 'Metro', NJD: 'Metro', NYI: 'Metro',
    NYR: 'Metro', PHI: 'Metro', PIT: 'Metro', WSH: 'Metro',
    CHI: 'Central', COL: 'Central', DAL: 'Central', MIN: 'Central',
    NSH: 'Central', STL: 'Central', UTA: 'Central', WPG: 'Central',
    ANA: 'Pacific', CGY: 'Pacific', EDM: 'Pacific', LAK: 'Pacific',
    SEA: 'Pacific', SJS: 'Pacific', VAN: 'Pacific', VGK: 'Pacific',
};

export const DIVISIONS: Division[] = ['Atlantic', 'Metro', 'Central', 'Pacific'];

export const DIVISION_LABEL: Record<Division, string> = {
    Atlantic: 'Atlantic',
    Metro: 'Metropolitan',
    Central: 'Central',
    Pacific: 'Pacific',
};

export const CONFERENCE_OF: Record<Division, 'Eastern' | 'Western'> = {
    Atlantic: 'Eastern',
    Metro: 'Eastern',
    Central: 'Western',
    Pacific: 'Western',
};

/** The 32 current tricodes, alphabetical. */
export const TEAM_TRICODES = Object.keys(DIVISION_OF).sort();

export function isTeamTricode(tri: string | null | undefined): tri is string {
    return !!tri && Object.prototype.hasOwnProperty.call(DIVISION_OF, tri);
}

export function teamMeta(tri: string): TeamMeta {
    const division = DIVISION_OF[tri];
    const names = TEAM_NAMES[tri] ?? { name: tri, short: tri };
    return {
        tri,
        name: names.name,
        common: names.short,
        division,
        conference: CONFERENCE_OF[division],
        color: teamColor(tri),
    };
}

export const ALL_TEAMS: TeamMeta[] = TEAM_TRICODES.map(teamMeta);
