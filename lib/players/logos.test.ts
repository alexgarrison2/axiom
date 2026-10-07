import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseName, countryOf, leagueLogo, nhlTeamLogo, normName, teamLogo } from './logos';
import registry from './logo-registry.json';

const exists = (src: string | null | undefined) => !!src && fs.existsSync(path.join(process.cwd(), 'public', src));

describe('normName / baseName', () => {
    it('folds accents, ligatures, punctuation and case', () => {
        expect(normName('Québec Remparts')).toBe('quebec remparts');
        expect(normName("Val-d'Or Foreurs")).toBe('val dor foreurs');
        expect(normName('Sherbrooke, Phœnix')).toBe('sherbrooke phoenix');
        expect(normName('Univ. of Minnesota-Duluth')).toBe('univ of minnesota duluth');
    });
    it('repairs UTF-8 read as Latin-1', () => {
        expect(normName('BrynÃ¤s IF')).toBe('brynas if');
        expect(normName('HC LitvÃ­nov')).toBe('hc litvinov');
    });
    it('strips junior, age, reserve, tier and colour tags', () => {
        expect(baseName('Färjestad BK J20')).toBe('farjestad bk');
        expect(baseName('Frölunda HC J18 2')).toBe('frolunda hc');
        expect(baseName('Skelleftea Jr.')).toBe('skelleftea');
        expect(baseName('Canada Red U17')).toBe('canada');
        expect(baseName("Shattuck St. Mary's 16U AAA")).toBe('shattuck st marys');
        expect(baseName('Russia (EHT)')).toBe('russia');
    });
});

describe('countryOf', () => {
    it('maps national team spellings to ISO codes', () => {
        expect(countryOf('Canada U20')).toBe('ca');
        expect(countryOf('Team USA')).toBe('us');
        expect(countryOf('United States')).toBe('us');
        expect(countryOf('Czech Republic U18')).toBe('cz');
        expect(countryOf('Czechia')).toBe('cz');
        expect(countryOf('Canada West U19')).toBe('ca');
        expect(countryOf('Suomi U20')).toBe('fi');
    });
    it('leaves clubs and mixed teams alone', () => {
        expect(countryOf('Halifax')).toBeNull();
        expect(countryOf('Team North America')).toBeNull();
        expect(countryOf('U.S. National U18 Team')).toBeNull();
    });
});

describe('NHL crests by era', () => {
    it('uses the era logo for relocated and rebranded clubs', () => {
        expect(nhlTeamLogo('Atlanta Thrashers', 20092010)).toMatch(/^\/logos\/nhl\/ATL_/);
        expect(nhlTeamLogo('Phoenix Coyotes', 20102011)).toMatch(/^\/logos\/nhl\/PHX_20032004-20132014/);
        expect(nhlTeamLogo('Arizona Coyotes', 20212022)).toMatch(/^\/logos\/nhl\/ARI_/);
        expect(nhlTeamLogo('Utah Hockey Club', 20242025)).toMatch(/^\/logos\/nhl\/UTA_/);
        expect(nhlTeamLogo('Buffalo Sabres', 20152016)).toMatch(/^\/logos\/nhl\/BUF_20102011-20192020/);
    });
    it('uses the current crest for current eras, including the current season', () => {
        expect(nhlTeamLogo('Colorado Avalanche', 20132014)).toBe('/logos/COL.svg');
        expect(nhlTeamLogo('Montréal Canadiens', 20262027)).toBe('/logos/MTL.svg');
        expect(nhlTeamLogo('Utah Mammoth', 20262027)).toBe('/logos/UTA.svg');
    });
    it('returns null for unknown clubs', () => {
        expect(nhlTeamLogo('Hartford Wolf Pack', 20202021)).toBeNull();
    });
});

describe('teamLogo', () => {
    it('flags national teams in any tournament', () => {
        expect(teamLogo('WJC-20', 'Canada U20', 20152016)).toEqual({ src: '/logos/flags/ca.svg', kind: 'flag' });
        expect(teamLogo('4 Nations', 'United States', 20242025)?.src).toBe('/logos/flags/us.svg');
    });
    it('finds CHL clubs by short or full name, season-aware', () => {
        expect(teamLogo('QMJHL', 'Halifax', 20122013)?.src).toMatch(/^\/logos\/teams\/qmjhl\//);
        expect(teamLogo('OHL', 'London Knights', 20152016)?.src).toMatch(/^\/logos\/teams\/ohl\//);
        expect(teamLogo('M-Cup', 'London Knights', 20152016)?.src).toBe(teamLogo('OHL', 'London Knights', 20152016)?.src);
    });
    it('gives junior sides their club crest', () => {
        const club = teamLogo('SHL', 'Färjestad BK', 20202021)?.src;
        expect(club).toBeTruthy();
        expect(teamLogo('J20 SuperElit', 'Färjestad BK J20', 20172018)?.src).toBe(club);
    });
    it('maps college name variants to one school', () => {
        const a = teamLogo('NCAA', 'Univ. of Massachusetts', 20182019)?.src;
        expect(a).toBeTruthy();
        expect(teamLogo('H-East', 'Massachusetts', 20182019)?.src).toBe(a);
        expect(teamLogo('NCAA', 'UMass (Amherst)', 20182019)?.src).toBe(a);
        expect(teamLogo('NCAA', 'Boston Univ.', 20152016)?.src).not.toBe(teamLogo('NCAA', 'Boston College', 20152016)?.src);
    });
    it('marks the NTDP wherever it plays', () => {
        expect(teamLogo('USHL', 'USNTDP Juniors', 20142015)?.src).toBe(teamLogo('NTDP', 'U.S. National U18 Team', 20212022)?.src);
    });
    it('returns null rather than guessing', () => {
        expect(teamLogo('Minor-ON', 'Cent. Ont. Wolves', 20062007)).toBeNull();
        expect(teamLogo('OHL', '', 20062007)).toBeNull();
        expect(teamLogo(null, null, 0)).toBeNull();
    });
});

describe('leagueLogo', () => {
    it('maps abbreviations, including tournaments and junior tiers', () => {
        for (const lg of ['QMJHL', 'OHL', 'WHL', 'NCAA', 'KHL', 'SHL', 'Liiga', 'WC', 'WJC-20', 'OG', 'J20 SuperElit', 'NTDP']) expect(leagueLogo(lg)).toMatch(/^\/logos\/leagues\//);
        expect(leagueLogo('WCup', 20162017)).not.toBe(leagueLogo('WCup', 20042005));
        expect(leagueLogo('Minor-ON')).toBeNull();
    });
});

describe('registry files', () => {
    it('points only at files that exist', () => {
        const r = registry as unknown as { leagues: Record<string, string | [number, number, string][]>; teams: Record<string, Record<string, [number, number, string][]>>; flags: Record<string, string>; nhl: Record<string, [number, number, string][]> };
        const files = new Set<string>();
        for (const v of Object.values(r.leagues)) (typeof v === 'string' ? [v] : v.map(e => e[2])).forEach(f => files.add(f));
        for (const t of Object.values(r.teams)) for (const eras of Object.values(t)) eras.forEach(e => files.add(e[2]));
        for (const eras of Object.values(r.nhl)) eras.forEach(e => files.add(e[2]));
        Object.values(r.flags).forEach(f => files.add(f));
        const missing = [...files].filter(f => !exists(`/logos/${f}`));
        expect(missing).toEqual([]);
    });
});
