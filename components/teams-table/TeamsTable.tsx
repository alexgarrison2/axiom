'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Segmented } from '@/components/ui/segmented';
import { FilterChip } from '@/components/ui/filter-chip';
import { PageHeading } from '@/components/ui/page-heading';
import { Crest } from '@/components/ui/crest';
import { shortSeasonTag } from '@/components/ui/stat-chip';
import { cn } from '@/lib/utils';
import { SEASON_ID } from '@/lib/season';
import { calculateTeamStats } from '@/utils/team-stats/calculate';
import { fetchJsonCached, leagueGamesUrl, leagueUrl, primeCache } from '@/utils/team-stats/client-cache';
import {
    DEFAULT_FILTERS, activeFilterCount, filterGames, groupByTeam, needsGameRows, sanitizeFilters,
    type Location, type Recent, type TableFilters, type TableView,
} from '@/utils/team-stats/filter';
import { signed, slateDate } from '@/utils/team-stats/format';
import { unpackGames } from '@/utils/team-stats/game-row';
import { seasonLabel, TEAM_SEASONS, seasonGames } from '@/utils/team-stats/season';
import { compareOfficial, computeStandings, officialKeysOf } from '@/utils/team-stats/standings';
import { DIVISION_OF, DIVISIONS, DIVISION_LABEL, TEAM_TRICODES } from '@/utils/team-stats/teams';
import type { Division, GameRow, LeaguePayload, Matchup, PackedGames, PeriodFilter, TeamStat } from '@/utils/team-stats/types';
import {
    COLUMN_BY_KEY, COLUMN_GROUPS, DEFAULT_HIDDEN, EMPHASIS_MIN_GP, THIN_CHANCES, columnValue, emphasisMap,
    type ColumnCtx, type Emphasis, type StatColumn,
} from './columns';
import { LENSES, LENS_BY_KEY, isLensKey, lensColumn, lensColumns, type LensKey } from './lenses';
import {
    CentreBar, Dash, DepthCells, DepthHeader, FormTape, Flow, Frac, OddsBar, Ordinal, ProjRange, RecordCell, SignedText, StSplit, StSplitHeader, Streak,
} from './cells';
import { FilterSheet } from '@/components/ui/filter-sheet';
import { Field, RangeFields } from './FilterFields';
import { HeaderCell, type SortDir } from './HeaderCell';
import { CELL_BG, HEAD_CELL, STICKY_EDGE } from './table-style';
import { PINNED_HEAD_HIDE, StickyHead, TableScroller } from './TableScroller';
import { LeagueHero, focusTeam } from './LeagueHero';

const STORAGE_KEY = 'ponyxg:teams-table:v4';

type Sort = { key: string; dir: SortDir };
type StandView = 'league' | 'conference' | 'division' | 'wildcard';
const STAND_VIEWS: { value: StandView; label: string }[] = [
    { value: 'league', label: 'League' },
    { value: 'conference', label: 'Conference' },
    { value: 'division', label: 'Division' },
    { value: 'wildcard', label: 'Wild card' },
];

interface Persisted {
    filters?: unknown;
    /** "All" lens: column keys the user turned off (everything else shows). */
    hidden?: string[];
    lens?: string;
    sorts?: Record<string, { key?: string; dir?: string }>;
    stand?: string;
}

function readPersisted(): Persisted {
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Persisted) : {};
    } catch {
        return {};
    }
}

interface TeamRow extends TeamStat {
    starterName?: string;
    starterStatus?: string;
    matchup?: Matchup;
    side?: 'home' | 'away';
}

const CLINCH_LABEL: Record<string, string> = {
    p: "Presidents' Trophy",
    z: 'Clinched division',
    y: 'Clinched conference',
    x: 'Clinched playoff spot',
    e: 'Eliminated',
};

/**
 * The league table on /teams. The server renders the default view (this
 * season, regular season, every team) so the table is the first paint;
 * game-level filters lazily load one compact games file per season and
 * recompute in the browser with the same pure functions.
 */
export default function TeamsTable({ initial }: { initial?: LeaguePayload }) {
    const [season, setSeason] = React.useState<string>(initial?.season ?? SEASON_ID);
    const [payloads, setPayloads] = React.useState<Record<string, LeaguePayload>>(() => (initial ? { [initial.season]: initial } : {}));
    const [filters, setFilters] = React.useState<TableFilters>(DEFAULT_FILTERS);
    const [hidden, setHidden] = React.useState<string[]>(DEFAULT_HIDDEN);
    const [lensKey, setLensKey] = React.useState<LensKey>('overview');
    const [sorts, setSorts] = React.useState<Partial<Record<LensKey, Sort>>>({});
    const [standView, setStandView] = React.useState<StandView>('division');
    const [perGameOpen, setPerGameOpen] = React.useState(false);
    const lens = LENS_BY_KEY.get(lensKey)!;
    const sort: Sort = sorts[lensKey] ?? lens.sort;
    const [games, setGames] = React.useState<Record<string, GameRow[]>>({});
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [hydrated, setHydrated] = React.useState(false);
    const captionId = React.useId();
    const rootRef = React.useRef<HTMLElement>(null);
    // Pinned header copy (below lg): follows the table's horizontal scroll and fades with it.
    const headRef = React.useRef<HTMLDivElement>(null);
    const [headMore, setHeadMore] = React.useState(false);
    const onScrollX = React.useCallback((left: number, more: boolean) => {
        if (headRef.current) headRef.current.scrollLeft = left;
        setHeadMore(prev => (prev === more ? prev : more));
    }, []);

    if (initial) primeCache(leagueUrl(initial.season), initial);

    const payload = payloads[season];
    const allowPlayoffs = !!payload?.hasPlayoffGames;
    const allowBracket = !!payload?.isCurrent && !!payload?.hasPlayoffGames;

    // Restore the session's view (validated), then ?season= and ?tab= from the URL.
    React.useEffect(() => {
        const saved = readPersisted();
        const params = new URLSearchParams(window.location.search);
        const qs = params.get('season');
        if (qs && (TEAM_SEASONS as readonly string[]).includes(qs)) setSeason(qs);
        if (Array.isArray(saved.hidden)) setHidden(saved.hidden.filter(k => COLUMN_BY_KEY.has(k)));
        const tab = params.get('tab') ?? saved.lens;
        if (isLensKey(tab)) setLensKey(tab);
        if (saved.sorts && typeof saved.sorts === 'object') {
            const ok: Partial<Record<LensKey, Sort>> = {};
            for (const [k, v] of Object.entries(saved.sorts)) {
                if (isLensKey(k) && v?.key && lensColumn(v.key)) ok[k] = { key: v.key, dir: v.dir === 'asc' ? 'asc' : 'desc' };
            }
            setSorts(ok);
        }
        if (STAND_VIEWS.some(v => v.value === saved.stand)) setStandView(saved.stand as StandView);
        if (saved.filters) setFilters(sanitizeFilters(saved.filters, { playoffs: true, bracket: true }));
        setHydrated(true);
    }, []);

    // Re-validate filters whenever the season (and what it allows) changes.
    React.useEffect(() => {
        if (!payload) return;
        setFilters(f => {
            const next = sanitizeFilters(f, { playoffs: allowPlayoffs, bracket: allowBracket });
            return JSON.stringify(next) === JSON.stringify(f) ? f : next;
        });
    }, [payload, allowPlayoffs, allowBracket]);

    React.useEffect(() => {
        if (!hydrated) return;
        try {
            window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, hidden, lens: lensKey, sorts, stand: standView }));
        } catch {
            /* private mode */
        }
    }, [filters, hidden, lensKey, sorts, standView, hydrated]);

    // Season payloads (the current one arrives with the page).
    React.useEffect(() => {
        if (payloads[season]) return;
        let live = true;
        fetchJsonCached<LeaguePayload>(leagueUrl(season))
            .then(p => live && setPayloads(prev => ({ ...prev, [season]: p })))
            .catch(() => live && setLoadError('Season unavailable'));
        return () => {
            live = false;
        };
    }, [season, payloads]);

    const wantRows = needsGameRows(filters);
    const periods = filters.period !== 'All';
    const gamesKey = `${season}|${periods ? 'full' : 'core'}`;
    React.useEffect(() => {
        if (!wantRows || games[gamesKey]) return;
        let live = true;
        fetchJsonCached<PackedGames>(leagueGamesUrl(season, periods))
            .then(p => live && setGames(prev => ({ ...prev, [gamesKey]: unpackGames(p) })))
            .catch(() => live && setLoadError('Game data unavailable'));
        return () => {
            live = false;
        };
    }, [wantRows, gamesKey, season, periods, games]);

    const seasonRows = games[gamesKey] ?? (periods ? undefined : games[`${season}|full`]);
    const pending = wantRows && !seasonRows;

    // ── rows ────────────────────────────────────────────────────────────────
    const model = React.useMemo(() => {
        if (!payload) return null;
        const base = payload.standings;
        const info = new Map(base.map(r => [r.tri, r]));
        const byTeam = seasonRows ? groupByTeam(seasonRows) : null;
        const attach = (s: TeamStat): TeamRow => {
            const i = info.get(s.tri);
            return i
                ? { ...s, ranking: i.ranking, divRank: i.divRank, isPlayoff: i.isPlayoff, clinch: i.clinch, magic_number: i.magic_number, tragic_number: i.tragic_number }
                : s;
        };
        const statsFor = (tri: string, opts: { location?: Location; starter?: string; dow?: number } = {}): TeamRow => {
            if (!byTeam || (!wantRows && !opts.starter && opts.dow === undefined && (opts.location ?? 'All') === 'All')) return info.get(tri) ?? attach(calculateTeamStats(tri, []));
            const g = filterGames(byTeam.get(tri) ?? [], {
                ...filters,
                location: opts.location ?? filters.location,
                starter: opts.starter,
                dayOfWeek: opts.dow,
            });
            return attach(calculateTeamStats(tri, g, filters.period));
        };

        // League-wide rows under the current filters (colour ranges + "all" view).
        const league = TEAM_TRICODES.map(tri => statsFor(tri));

        let rows: TeamRow[];
        let paired = false;
        if (filters.view === 'today' || filters.view === 'tomorrow') {
            paired = true;
            const date = slateDate(filters.view === 'today' ? 0 : 1);
            const dow = filters.withDow ? new Date(`${date}T12:00:00`).getDay() : undefined;
            rows = payload.matchups
                .filter(m => m.date === date)
                .flatMap(m => {
                    const away = statsFor(m.away, {
                        location: filters.withLocation ? 'Away' : undefined,
                        starter: filters.withStarter ? m.awayStarter : undefined,
                        dow,
                    });
                    const home = statsFor(m.home, {
                        location: filters.withLocation ? 'Home' : undefined,
                        starter: filters.withStarter ? m.homeStarter : undefined,
                        dow,
                    });
                    return [
                        { ...away, matchup: m, side: 'away' as const, starterName: m.awayStarter, starterStatus: m.awayStarterStatus },
                        { ...home, matchup: m, side: 'home' as const, starterName: m.homeStarter, starterStatus: m.homeStarterStatus },
                    ];
                });
        } else if (filters.view === 'bracket') {
            paired = true;
            const { brackets } = computeStandings(base, [], seasonGames(season));
            const byTri = new Map(league.map(r => [r.tri, r]));
            rows = brackets.flatMap(b => b.matchups.flatMap(([hi, lo]) => [byTri.get(hi)!, byTri.get(lo)!]).filter(Boolean));
        } else {
            rows = league.filter(r => {
                if (filters.divisions.length && !filters.divisions.includes(DIVISION_OF[r.tri] as Division)) return false;
                if (filters.position === 'In' && !r.isPlayoff) return false;
                if (filters.position === 'Out' && r.isPlayoff) return false;
                return true;
            });
        }
        return { league, rows, paired };
    }, [payload, seasonRows, filters, wantRows, season]);

    const hiddenSet = React.useMemo(() => new Set(hidden), [hidden]);
    const ratingsMissing = !payload?.ratings;
    const ctx: ColumnCtx = React.useMemo(
        () => {
            const rs = Object.values(payload?.ratings ?? {});
            const avg = (k: 'pp_rating' | 'pk_rating') => {
                const v = rs.map(r => r[k]).filter((x): x is number => typeof x === 'number');
                return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
            };
            const leagueSt = rs.length ? { pp: avg('pp_rating'), pk: avg('pk_rating') } : null;
            return { ratings: payload?.ratings ?? null, extras: payload?.extras ?? null, projections: payload?.projections ?? null, seasonGames: seasonGames(season), leagueSt };
        },
        [payload, season],
    );
    // The lens's columns; "All" is every raw column the user has not hidden. Columns with no value for
    // any team (model numbers for a past season) drop out, and so do ranks of a dropped column.
    const columns: { col: StatColumn; groupEnd: boolean; group: string; link?: LensKey }[] = React.useMemo(() => {
        const base =
            lensKey === 'all'
                ? COLUMN_GROUPS.flatMap(g => {
                      const cols = g.cols.map(k => COLUMN_BY_KEY.get(k)).filter((c): c is StatColumn => !!c && !hiddenSet.has(c.key) && !(c.rating && ratingsMissing));
                      return cols.map((col, i) => ({ col, groupEnd: i === cols.length - 1, group: g.name }));
                  })
                : lensColumns(lens);
        const teams = payload?.standings ?? [];
        const has = (c: StatColumn | undefined): boolean => {
            if (!c) return false;
            if (c.rankOf) return has(lensColumn(c.rankOf));
            if (!c.derive && !c.rating) return true;
            return teams.some(r => Number.isFinite(columnValue(c, r, ctx)));
        };
        const kept = base.filter(c => has(c.col));
        // Re-mark group ends after dropping columns.
        return kept.map((c, i) => ({ ...c, groupEnd: i === kept.length - 1 || kept[i + 1].group !== c.group }));
    }, [lensKey, lens, hiddenSet, ratingsMissing, payload, ctx]);
    const groupSpans = React.useMemo(() => {
        const out: { name: string; n: number; link?: LensKey }[] = [];
        for (const c of columns) {
            const last = out[out.length - 1];
            if (last && last.name === c.group) last.n++;
            else out.push({ name: c.group, n: 1, link: c.link });
        }
        return out;
    }, [columns]);

    // League rank (1 = best, ties share) for every ordinal column and every column a rank cell shows.
    const ranks = React.useMemo(() => {
        const out = new Map<string, Map<string, number>>();
        if (!model) return out;
        const want = new Set<string>();
        for (const { col } of columns) {
            if (col.kind === 'ordinal' || col.kind === 'stSplit') want.add(col.rankOf ?? col.key);
            if (col.kind === 'rank' && col.rankOf) want.add(col.rankOf);
        }
        for (const key of want) {
            const col = lensColumn(key);
            if (!col || col.better === 'none') continue;
            const vals = model.league
                .filter(r => col.model || col.rating || r.gp > 0)
                .map(r => [r.tri, columnValue(col, r, ctx)] as const)
                .filter(([, v]) => Number.isFinite(v))
                .sort((x, y) => (col.better === 'low' ? x[1] - y[1] : y[1] - x[1]));
            const m = new Map<string, number>();
            vals.forEach(([tri, v], i) => m.set(tri, i > 0 && v === vals[i - 1][1] ? m.get(vals[i - 1][0])! : i + 1));
            out.set(key, m);
        }
        return out;
    }, [model, columns, ctx]);
    const valueOf = React.useCallback(
        (col: StatColumn, r: TeamStat) => (col.kind === 'rank' && col.rankOf ? (ranks.get(col.rankOf)?.get(r.tri) ?? NaN) : columnValue(col, r, ctx)),
        [ranks, ctx],
    );

    // Per column: the league's top and bottom few (bold / dim). Results need EMPHASIS_MIN_GP games
    // and enough chances; ratings and model numbers are season-independent. Drawn cells carry their own marks.
    const emphasis = React.useMemo(() => {
        const out = new Map<string, Map<string, Emphasis>>();
        if (!model) return out;
        for (const { col } of columns) {
            if (col.better === 'none' || (col.kind && col.kind !== 'num' && col.kind !== 'ordinal' && col.kind !== 'stSplit')) continue;
            const entries = model.league
                .filter(r => (col.rating || col.model || r.gp >= EMPHASIS_MIN_GP) && !col.thin?.(r))
                .map(r => [r.tri, valueOf(col, r)] as const);
            out.set(col.key, emphasisMap(entries, col.better));
        }
        return out;
    }, [model, columns, valueOf]);

    // Column widths from the widest label or formatted value, so numbers never crowd.
    const widths = React.useMemo(() => {
        const out = new Map<string, number>();
        const rows = model?.league ?? [];
        for (const { col } of columns) {
            let chars = 0;
            for (const r of rows) {
                const v = valueOf(col, r);
                if (Number.isFinite(v)) chars = Math.max(chars, col.format(v).length);
            }
            out.set(col.key, colWidth(col, chars));
        }
        // A group header wider than its columns (a one-column group) widens the group's last column.
        let start = 0;
        columns.forEach((c, i) => {
            if (!c.groupEnd) return;
            const span = columns.slice(start, i + 1);
            const need = Math.round(c.group.length * 8.4) + (c.link ? 40 : 26);
            const have = span.reduce((w, x) => w + (out.get(x.col.key) ?? 0), 0);
            if (need > have) out.set(c.col.key, (out.get(c.col.key) ?? 0) + need - have);
            start = i + 1;
        });
        return out;
    }, [model, columns, valueOf]);
    const widthOf = (col: StatColumn) => widths.get(col.key) ?? colWidth(col, 0);

    // A sort on a column this lens does not show falls back to the lens's own sort.
    const activeSort: Sort = columns.some(c => c.col.key === sort.key && !NO_SORT.has(c.col.kind ?? 'num')) ? sort : lens.sort;

    const officialPos = React.useMemo(() => {
        if (!payload) return new Map<string, number>();
        const order = [...payload.standings].sort((a, b) => compareOfficial(officialKeysOf(a), officialKeysOf(b)) || a.tri.localeCompare(b.tri));
        return new Map(order.map((r, i) => [r.tri, i]));
    }, [payload]);

    const sorted = React.useMemo(() => {
        if (!model) return [];
        if (model.paired) return model.rows;
        const col = lensColumn(activeSort.key);
        const pos = officialPos;
        // Rank sorts by official order: ascending is first place first.
        const val = (r: TeamRow) => {
            if (!col || col.key === 'ranking') return pos.get(r.tri) ?? 99;
            const v = valueOf(col, r);
            return Number.isFinite(v) ? v : null;
        };
        return [...model.rows].sort((a, b) => {
            const va = val(a);
            const vb = val(b);
            if (va === null && vb === null) return (pos.get(a.tri) ?? 0) - (pos.get(b.tri) ?? 0);
            if (va === null) return 1;
            if (vb === null) return -1;
            if (va !== vb) return activeSort.dir === 'desc' ? vb - va : va - vb;
            return (pos.get(a.tri) ?? 0) - (pos.get(b.tri) ?? 0);
        });
    }, [model, activeSort.key, activeSort.dir, officialPos, valueOf]);

    // Standings lens: sections (league, conference, division, wild card) with playoff cut lines.
    const items = React.useMemo((): TableItem[] => {
        const plain = sorted.map((row, i) => ({ type: 'row' as const, row, pos: i + 1 }));
        if (lensKey !== 'standings' || model?.paired || !payload) return plain;
        const present = new Set(sorted.map(r => r.tri));
        const conf = (tri: string) => payload.teams.find(t => t.tri === tri)?.conference;
        const section = (title: string, rows: TeamRow[], cut?: number, cutLabel?: string, posLabel?: (i: number) => string): TableItem[] =>
            rows.length
                ? [
                      { type: 'section', title },
                      ...rows.flatMap((row, i): TableItem[] => [
                          ...(cut !== undefined && i === cut ? [{ type: 'cut' as const, label: cutLabel ?? '' }] : []),
                          { type: 'row', row, pos: i + 1, posLabel: posLabel?.(i) },
                      ]),
                  ]
                : [];
        const byOfficial = (rows: TeamRow[]) => [...rows].sort((a, b) => (officialPos.get(a.tri) ?? 0) - (officialPos.get(b.tri) ?? 0));
        if (standView === 'league') return plain;
        if (standView === 'conference')
            return (['Eastern', 'Western'] as const).flatMap(c => section(c, sorted.filter(r => conf(r.tri) === c), 8, 'Playoff line'));
        if (standView === 'division') return DIVISIONS.flatMap(d => section(DIVISION_LABEL[d], sorted.filter(r => DIVISION_OF[r.tri] === d), 3, 'Top 3'));
        // Wild card: each division's top three, then the conference race for the last two spots.
        const all = byOfficial(payload.standings as TeamRow[]).map(r => sorted.find(x => x.tri === r.tri) ?? r);
        return (['Eastern', 'Western'] as const).flatMap(c => {
            const divs = DIVISIONS.filter(d => all.some(r => DIVISION_OF[r.tri] === d && conf(r.tri) === c));
            const tops = divs.map(d => all.filter(r => DIVISION_OF[r.tri] === d).slice(0, 3));
            const rest = all.filter(r => conf(r.tri) === c && !tops.flat().includes(r));
            const keep = (rows: TeamRow[]) => rows.filter(r => present.has(r.tri));
            return [
                ...divs.flatMap((d, i) => section(DIVISION_LABEL[d], keep(tops[i]))),
                ...section(`${c} wild card`, keep(rest), 2, 'Playoff line', i => (i < 2 ? `WC${i + 1}` : String(i + 1))),
            ];
        });
    }, [sorted, lensKey, standView, model, payload, officialPos]);

    // ── handlers ────────────────────────────────────────────────────────────
    const setF = <K extends keyof TableFilters>(k: K, v: TableFilters[K]) => setFilters(f => ({ ...f, [k]: v }));
    const changeSeason = (s: string) => {
        setSeason(s);
        try {
            const url = new URL(window.location.href);
            if (s === SEASON_ID) url.searchParams.delete('season');
            else url.searchParams.set('season', s);
            window.history.replaceState(window.history.state, '', url);
        } catch {
            /* ignore */
        }
    };
    const onSort = (col: StatColumn) =>
        setSorts(prev => ({
            ...prev,
            [lensKey]:
                activeSort.key === col.key
                    ? { key: col.key, dir: activeSort.dir === 'desc' ? 'asc' : 'desc' }
                    : { key: col.key, dir: col.key === 'ranking' || col.kind === 'rank' || col.better === 'low' ? 'asc' : 'desc' },
        }));
    const selectLens = (k: LensKey) => {
        setLensKey(k);
        try {
            const url = new URL(window.location.href);
            if (k === 'overview') url.searchParams.delete('tab');
            else url.searchParams.set('tab', k);
            window.history.replaceState(window.history.state, '', url);
        } catch {
            /* ignore */
        }
    };

    // Phones: "26-27" season labels so the switcher sits beside the heading (as on the team page).
    const seasonOptions = TEAM_SEASONS.map(s => ({
        value: s,
        label: (
            <>
                <span className="sm:hidden">{shortSeasonTag(seasonLabel(s))}</span>
                <span className="max-sm:hidden">{seasonLabel(s)}</span>
            </>
        ),
        ariaLabel: seasonLabel(s),
    }));
    const active = activeFilterCount(filters);
    const chips = activeChips(filters, setFilters);
    const phoneChips = activeChips(filters, setFilters, true);

    if (!payload) {
        return (
            <div className="panel p-card text-micro uppercase tracking-label text-fg-3" role="status">
                {loadError ? <span className="text-neg">{loadError}</span> : 'Loading'}
            </div>
        );
    }

    const scopeLabel = filters.scope === 'playoffs' ? 'playoffs' : 'regular season';
    const viewNote = filters.view === 'today' ? 'today' : filters.view === 'tomorrow' ? 'tomorrow' : filters.view === 'bracket' ? 'bracket' : null;
    const isPrior = season !== SEASON_ID;
    const dot = (
        <span aria-hidden="true" className="text-fg-disabled">
            ·
        </span>
    );
    const captionParts = (
        <>
            <span className="text-fg-1">
                {payload.seasonLabel} {scopeLabel}
            </span>
            {dot}
            <span>
                <span className="text-fg-1">{payload.maxGp}</span> GP
            </span>
            {viewNote ? (
                <>
                    {dot}
                    <span className="text-brand">{viewNote}</span>
                </>
            ) : null}
            {pending ? <span className="live-dot ml-1" role="status" aria-label="Updating" /> : null}
        </>
    );
    // One points scale for every projection cell.
    const projVals = Object.values(payload.projections ?? {});
    const projRange: [number, number] = projVals.length
        ? [Math.min(...projVals.map(p => p.p10).filter(Number.isFinite)) - 2, Math.max(...projVals.map(p => p.p90).filter(Number.isFinite)) + 2]
        : [0, 1];
    // Team column: crest + tricode only; paired views add the starter and the moneyline.
    const paired = !!model?.paired;
    const teamColClass = !paired ? '[--team-col:84px] md:[--team-col:96px]' : filters.withStarter ? '[--team-col:132px] md:[--team-col:184px]' : '[--team-col:80px] md:[--team-col:128px]';

    const colgroup = (
        <colgroup>
            <col style={{ width: 'var(--team-col)' }} />
            {columns.map(({ col }) => (
                <col key={col.key} style={{ width: widthOf(col) }} />
            ))}
        </colgroup>
    );
    const headRows = (
        <>
            <tr>
                <td className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-6')} />
                {groupSpans.map((g, i) => (
                    <th key={`${g.name}-${i}`} scope="colgroup" colSpan={g.n} className={cn(HEAD_CELL, 'h-6 overflow-hidden border-r border-r-line-strong px-2.5 text-left')}>
                        {g.link ? (
                            <button
                                type="button"
                                onClick={() => selectLens(g.link!)}
                                title={`Open ${LENS_BY_KEY.get(g.link)?.label}`}
                                className="group/gl inline-flex items-center gap-1.5 whitespace-nowrap text-micro font-semibold uppercase tracking-label text-fg-2 hover:text-brand"
                            >
                                {g.name}
                                <span aria-hidden="true" className="text-fg-3 group-hover/gl:text-brand">
                                    ›
                                </span>
                            </button>
                        ) : (
                            <span className="whitespace-nowrap text-micro font-semibold uppercase tracking-label text-fg-2">{g.name}</span>
                        )}
                    </th>
                ))}
            </tr>
            <tr>
                <th scope="col" className={cn(HEAD_CELL, STICKY_EDGE, 'top-6 z-[4] h-8 border-b-line-strong px-2.5 text-left')}>
                    <span className="text-micro font-medium tracking-[0.04em] text-fg-3">Team</span>
                </th>
                {columns.map(({ col, groupEnd }) => (
                    <HeaderCell
                        key={col.key}
                        label={col.kind === 'depth' ? <DepthHeader /> : col.kind === 'stSplit' ? <StSplitHeader label={col.label} /> : col.label}
                        title={col.title}
                        direction={model?.paired || NO_SORT.has(col.kind ?? 'num') ? undefined : activeSort.key === col.key ? activeSort.dir : null}
                        onSort={model?.paired || NO_SORT.has(col.kind ?? 'num') ? undefined : () => onSort(col)}
                        align={LEFT_KINDS.has(col.kind ?? (col.key === 'ranking' ? 'ranking' : 'num')) ? 'left' : 'right'}
                        className={cn(HEAD_CELL, 'top-6 border-b-line-strong', groupEnd && 'border-r border-r-line-strong', activeSort.key === col.key && !model?.paired && 'shadow-[inset_0_-2px_0_rgb(var(--brand-rgb))]')}
                        caseless
                        stretch={col.kind === 'stSplit'}
                    />
                ))}
            </tr>
        </>
    );
    const tableCls = cn('table-fixed border-separate border-spacing-0 text-caption tabular-nums', teamColClass);
    const tableStyle = { width: `calc(var(--team-col) + ${columns.reduce((w, c) => w + widthOf(c.col), 0)}px)`, minWidth: '100%' };

    return (
        <section ref={rootRef} aria-label="League table" className="league flex flex-col gap-1.5">
            <PageHeading
                title="Teams"
                tag={isPrior ? shortSeasonTag(season) : undefined}
                actions={
                    <div className="flex items-center gap-3">
                        <span aria-hidden="true" className="hidden items-center gap-2 whitespace-nowrap text-micro font-medium uppercase tracking-label text-fg-3 md:flex">
                            {captionParts}
                        </span>
                        <Segmented label="Season" size="sm" value={season} onChange={changeSeason} options={seasonOptions} />
                    </div>
                }
            />

            {payload.isCurrent || payload.maxGp > 0 ? (
                <div className="mb-2">
                    <LeagueHero key={payload.season} payload={payload} rootRef={rootRef} />
                </div>
            ) : null}

            {/* Phones and tablets (incl. landscape phones): every filter and column choice in two sheets; the active filters stay on the page. */}
            <div className="flex flex-wrap items-center gap-2 lg:hidden">
                <FilterSheet activeCount={active} onReset={() => setFilters({ ...DEFAULT_FILTERS, ranges: {} })}>
                    <FilterBar filters={filters} setF={setF} setFilters={setFilters} allowPlayoffs={allowPlayoffs} allowBracket={allowBracket} chips={chips} perGameOpen sheet />
                </FilterSheet>
                {lensKey === 'all' ? (
                    <FilterSheet title="Columns" triggerLabel="Columns">
                        <ColumnPicker hidden={hidden} setHidden={setHidden} ratingsMissing={ratingsMissing} sheet />
                    </FilterSheet>
                ) : null}
                {phoneChips.length > 0 ? <ActiveChips chips={phoneChips} /> : null}
            </div>
            <FilterBar filters={filters} setF={setF} setFilters={setFilters} allowPlayoffs={allowPlayoffs} allowBracket={allowBracket} chips={chips} perGameOpen={perGameOpen} />
            <div className="hidden items-center justify-end gap-1 lg:flex">
                <FilterChip className={CHIP} selected={perGameOpen || hasPerGame(filters)} onSelectedChange={setPerGameOpen} aria-expanded={perGameOpen}>
                    Per game
                </FilterChip>
                {active > 0 ? (
                    <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, ranges: {} })} className="min-h-7 px-2 text-micro font-medium uppercase tracking-chip text-fg-3 hover:text-fg-1 coarse:min-h-9">
                        Clear {active}
                    </button>
                ) : null}
            </div>

            <LensBar value={lensKey} onChange={selectLens} />
            {lensKey === 'standings' && !paired ? (
                <div className="flex items-center gap-3">
                    <Segmented label="Standings" size="sm" value={standView} onChange={setStandView} options={STAND_VIEWS} />
                </div>
            ) : null}
            {lensKey === 'all' ? <ColumnPicker hidden={hidden} setHidden={setHidden} ratingsMissing={ratingsMissing} /> : null}

            {loadError ? (
                <p role="alert" className="text-micro uppercase tracking-label text-neg">
                    {loadError}
                </p>
            ) : null}

            {/* Bordered panel: the caption bar stays put, only the table scrolls (both axes). Below lg (and on short
                screens) the page scrolls the rows and a pinned copy of the header follows the table sideways. */}
            <div
                className={cn(
                    '-mx-4 overflow-hidden border-y border-line bg-surface-1 max-lg:overflow-clip md:mx-0 md:rounded-card md:border-x [@media(max-height:500px)]:overflow-clip',
                    headMore && 'max-lg:edge-fade-right',
                )}
            >
                <StickyHead ref={headRef} className="bg-bg">
                    <table className={tableCls} style={tableStyle}>
                        {colgroup}
                        <thead>{headRows}</thead>
                    </table>
                </StickyHead>
                <TableScroller label={`${payload.seasonLabel} team table`} pageScroll fade={false} onScrollX={onScrollX}>
                    <table aria-labelledby={captionId} className={tableCls} style={tableStyle} aria-busy={pending || undefined}>
                        <caption id={captionId} className="sr-only">
                            {captionParts}
                        </caption>
                        {colgroup}
                        <thead className={PINNED_HEAD_HIDE}>{headRows}</thead>
                        <tbody className={cn(pending && 'opacity-60 transition-opacity')}>
                            {sorted.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + 1} className="h-16 px-4 text-left text-micro uppercase tracking-label text-fg-3">
                                        <span className="sticky left-4">{filters.view === 'today' || filters.view === 'tomorrow' ? 'No games' : 'No teams'}</span>
                                    </td>
                                </tr>
                            ) : (
                                items.map((it, idx) =>
                                    it.type === 'section' ? (
                                        <tr key={`s-${it.title}`}>
                                            <th scope="rowgroup" colSpan={columns.length + 1} className="h-8 border-b border-line-strong bg-bg px-2.5 pt-2 text-left">
                                                <span className="sticky left-2.5 text-micro font-bold uppercase tracking-label text-fg-2">{it.title}</span>
                                            </th>
                                        </tr>
                                    ) : it.type === 'cut' ? (
                                        <tr key={`c-${idx}`} aria-hidden="true">
                                            <td colSpan={columns.length + 1} className="h-4 border-t border-dashed border-line-strong bg-surface-1 p-0 text-left">
                                                <span className="sticky left-2.5 text-micro uppercase tracking-label text-fg-3">{it.label}</span>
                                            </td>
                                        </tr>
                                    ) : (
                                        <Row
                                            key={`${it.row.tri}-${idx}`}
                                            row={it.row}
                                            pos={it.posLabel ?? String(it.pos)}
                                            columns={columns}
                                            emphasis={emphasis}
                                            ranks={ranks}
                                            valueOf={valueOf}
                                            ctx={ctx}
                                            projRange={projRange}
                                            sortKey={model?.paired ? null : activeSort.key}
                                            payload={payload}
                                            paired={!!model?.paired}
                                            period={filters.period}
                                            showStarter={filters.withStarter}
                                            pairEnd={!!model?.paired && idx % 2 === 1 && idx < items.length - 1}
                                        />
                                    ),
                                )
                            )}
                        </tbody>
                    </table>
                </TableScroller>
            </div>

            <Legend clinch={!!payload.clinch} />
        </section>
    );
}

/** Wide enough for the label (12px, tracked) or the widest value (13px tabular) plus padding; drawn cells are fixed. */
const colWidth = (c: StatColumn, valueChars: number) => {
    if (c.key === 'ranking') return 72;
    if (c.kind === 'rank' || c.kind === 'pos') return 52;
    if (c.width) return c.width;
    const extra = c.kind === 'ordinal' ? 36 : 0;
    return Math.max(44, Math.round(c.label.length * 7.2) + 22, Math.round(valueChars * 7.4) + 22 + extra);
};

/** Drawn and positional cells that do not sort. */
const NO_SORT = new Set(['pos', 'record', 'homeRec', 'awayRec', 'l10', 'streak', 'form', 'depth', 'frac']);
/** Cells that read from the left: ranks, bars, tapes. */
const LEFT_KINDS = new Set(['ranking', 'pos', 'rank', 'modelBar', 'share', 'odds', 'proj', 'flow', 'depth', 'form', 'frac', 'stSplit']);

type TableItem =
    | { type: 'row'; row: TeamRow; pos: number; posLabel?: string }
    | { type: 'section'; title: string }
    | { type: 'cut'; label: string };

/** The lens tabs: one question each. Scrolls sideways on phones. */
function LensBar({ value, onChange }: { value: LensKey; onChange: (k: LensKey) => void }) {
    return (
        <div role="tablist" aria-label="Table view" className="-mx-4 flex overflow-x-auto border-b border-line px-4 [scrollbar-width:none] md:mx-0 md:px-0">
            {LENSES.map(l => (
                <button
                    key={l.key}
                    type="button"
                    role="tab"
                    aria-selected={value === l.key}
                    onClick={() => onChange(l.key)}
                    className={cn(
                        '-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-micro font-semibold uppercase tracking-label transition-colors coarse:min-h-11',
                        value === l.key ? 'border-brand text-brand' : 'border-transparent text-fg-3 hover:text-fg-1',
                    )}
                >
                    {l.label}
                </button>
            ))}
        </div>
    );
}

/** Record counts read 0 (not —) before a team's first game. */
const COUNTING = new Set(['gp', 'wins', 'losses', 'otl', 'points', 'rw', 'ranking']);

const DIV_SHORT: Record<Division, string> = { Atlantic: 'ATL', Metro: 'MET', Central: 'CEN', Pacific: 'PAC' };

/** The sorted column's faint cyan wash, laid over the zebra / hover background. */
const SORTED_WASH = { backgroundImage: 'linear-gradient(rgb(var(--brand-rgb) / 0.045), rgb(var(--brand-rgb) / 0.045))' };

function Row({
    row, pos, columns, emphasis, ranks, valueOf, ctx, projRange, sortKey, payload, paired, period, showStarter, pairEnd,
}: {
    row: TeamRow;
    pos: string;
    columns: { col: StatColumn; groupEnd: boolean }[];
    emphasis: Map<string, Map<string, Emphasis>>;
    ranks: Map<string, Map<string, number>>;
    valueOf: (col: StatColumn, r: TeamStat) => number;
    ctx: ColumnCtx;
    projRange: [number, number];
    sortKey: string | null;
    payload: LeaguePayload;
    paired: boolean;
    period: PeriodFilter;
    showStarter: boolean;
    pairEnd: boolean;
}) {
    const router = useRouter();
    const meta = payload.teams.find(t => t.tri === row.tri);
    const clinch = row.clinch ?? null;
    const odds = paired && row.matchup && row.side ? { ml: row.side === 'home' ? row.matchup.homeVegasOdds : row.matchup.awayVegasOdds } : null;
    const href = `/teams/${row.tri}`;
    // The whole row opens the team page; the crest + tricode stay the keyboard / link target.
    const open = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('a,button') || e.metaKey || e.ctrlKey) return;
        router.push(href);
    };
    return (
        <tr
            data-tri={row.tri}
            onClick={open}
            onMouseEnter={e => focusTeam(e.currentTarget.closest('.league'), row.tri)}
            onMouseLeave={e => focusTeam(e.currentTarget.closest('.league'), null)}
            className={cn('group cursor-pointer', pairEnd && '[&>*]:border-b-8 [&>*]:border-b-bg')}
        >
            <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-8 shadow-[inset_0_-1px_0_var(--line)] pl-2 pr-1.5 text-left font-normal md:pl-2.5')}>
                <div className="flex h-8 items-center gap-2">
                    <Link href={href} prefetch={false} title={meta?.name} className="flex h-8 min-w-0 items-center gap-2 group-hover:text-brand">
                        <Crest tri={row.tri} size={28} className="-my-0.5 h-7 w-7 drop-shadow-none" />
                        <span className="text-body font-bold text-fg-1 group-hover:text-inherit">{row.tri}</span>
                        {meta ? <span className="sr-only">, {meta.name}</span> : null}
                        {paired && showStarter && row.starterName ? (
                            <span className="truncate text-micro text-fg-2">
                                {row.starterName.split(' ').slice(-1)[0]}
                                <span className="sr-only"> ({row.starterStatus})</span>
                            </span>
                        ) : null}
                    </Link>
                    {clinch ? (
                        <span title={CLINCH_LABEL[clinch]} className={cn('-ml-1 self-start pt-1.5 text-micro font-bold uppercase leading-none', clinch === 'e' ? 'text-neg' : 'text-pos')}>
                            {clinch}
                            <span className="sr-only"> ({CLINCH_LABEL[clinch]})</span>
                        </span>
                    ) : null}
                    {odds?.ml != null ? (
                        <span className="ml-auto hidden shrink-0 text-micro text-fg-2 md:inline">
                            <span className="sr-only">{row.side === 'home' ? 'Home' : 'Away'} moneyline </span>
                            {odds.ml > 0 ? `+${odds.ml}` : signed(odds.ml)}
                        </span>
                    ) : null}
                </div>
            </th>
            {columns.map(({ col, groupEnd }) => {
                const sorted = sortKey === col.key;
                const kind = col.kind ?? 'num';
                const base = cn('lt-cell', LEFT_KINDS.has(kind) ? 'text-left' : 'text-right', groupEnd && 'border-r border-r-line-strong');
                const style = sorted ? SORTED_WASH : undefined;
                const dash = <Dash />;
                const drawn = drawnCell(kind, row, pos, ctx, projRange);
                if (drawn !== undefined) {
                    return (
                        <td key={col.key} className={base} style={style}>
                            {drawn}
                        </td>
                    );
                }
                if (col.key === 'ranking') {
                    const rank = row.ranking && row.ranking !== '—' ? row.ranking.slice(1) : null;
                    const div = DIVISION_OF[row.tri] as Division | undefined;
                    return (
                        <td key={col.key} className={cn(base, 'text-left')} style={style}>
                            {rank && div ? (
                                <span className="inline-flex items-center gap-1.5">
                                    <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', row.isPlayoff ? 'bg-pos' : 'border border-fg-disabled')} />
                                    <span className="text-micro tracking-[0.08em] text-fg-3">{DIV_SHORT[div]}</span>
                                    <span className="font-semibold text-fg-1">{rank}</span>
                                    <span className="sr-only">{row.isPlayoff ? ' (in a playoff spot)' : ' (outside the playoff spots)'}</span>
                                </span>
                            ) : (
                                dash
                            )}
                        </td>
                    );
                }
                const counting = COUNTING.has(col.key);
                const blank = row.gp === 0 && !col.rating && !col.model && !counting ? true : period !== 'All' && col.fullGameOnly;
                const v = blank ? NaN : valueOf(col, row);
                if (kind === 'rank') {
                    return (
                        <td key={col.key} className={cn(base, 'text-body font-bold text-fg-1')} style={style}>
                            {Number.isFinite(v) ? v : dash}
                        </td>
                    );
                }
                if (!Number.isFinite(v) || (col.count && v === 0)) {
                    return (
                        <td key={col.key} className={base} style={style}>
                            {dash}
                        </td>
                    );
                }
                const thin = !col.rating && col.thin?.(row);
                const e = thin ? undefined : emphasis.get(col.key)?.get(row.tri);
                let body: React.ReactNode = col.format(v);
                if (kind === 'signed') body = <SignedText col={col} v={v} />;
                else if (kind === 'ordinal') body = <Ordinal text={col.format(v)} rank={thin ? undefined : ranks.get(col.rankOf ?? col.key)?.get(row.tri)} />;
                else if (kind === 'modelBar' && col.bar) body = <CentreBar v={v} mid={col.bar.mid} span={col.bar.span} text={col.format(v)} tone="model" />;
                else if (kind === 'share' && col.bar) body = <CentreBar v={v} mid={col.bar.mid} span={col.bar.span} text={col.format(v)} tone="sign" width={64} />;
                else if (kind === 'odds') body = <OddsBar pct={v} />;
                else if (kind === 'stSplit') {
                    const r = ctx.ratings?.[row.tri];
                    const inner = <Ordinal text={col.format(v)} rank={ranks.get(col.rankOf ?? col.key)?.get(row.tri)} />;
                    body =
                        r && typeof r.pp_rating === 'number' && typeof r.pk_rating === 'number' && ctx.leagueSt ? (
                            <StSplit pp={r.pp_rating} pk={r.pk_rating} avg={ctx.leagueSt}>
                                {inner}
                            </StSplit>
                        ) : (
                            inner
                        );
                }
                else if (kind === 'frac' && col.frac) {
                    const [n, d] = col.frac(row);
                    body = <Frac n={n} d={d} />;
                }
                return (
                    <td
                        key={col.key}
                        title={thin ? `Thin sample: no rank yet` : undefined}
                        className={cn(base, e === 'hi' && 'font-semibold text-fg-1', (e === 'lo' || thin) && 'text-fg-3', col.count && !e && 'text-fg-1', col.key === 'points' && 'font-bold text-fg-1')}
                        style={style}
                    >
                        {body}
                    </td>
                );
            })}
        </tr>
    );
}

/** Cells drawn from the row and its extras rather than one number; undefined = not a drawn kind. */
function drawnCell(kind: string, row: TeamRow, pos: string, ctx: ColumnCtx, projRange: [number, number]): React.ReactNode | undefined {
    const ex = ctx.extras?.[row.tri];
    switch (kind) {
        case 'pos':
            return <span className={cn('text-body font-bold', /^WC/.test(pos) ? 'text-micro text-fg-2' : 'text-fg-1')}>{pos}</span>;
        case 'record':
            return row.gp ? <RecordCell rec={[row.wins, row.losses, row.otl]} strong /> : <Dash />;
        case 'homeRec':
            return ex ? <RecordCell rec={ex.home} /> : <Dash />;
        case 'awayRec':
            return ex ? <RecordCell rec={ex.away} /> : <Dash />;
        case 'l10':
            return ex ? <RecordCell rec={ex.l10} /> : <Dash />;
        case 'streak':
            return <Streak s={ex?.streak ?? null} />;
        case 'form':
            return <FormTape extra={ex} />;
        case 'flow':
            return <Flow row={row} />;
        case 'depth':
            return <DepthCells r={ctx.ratings?.[row.tri] ?? undefined} />;
        case 'proj': {
            const p = ctx.projections?.[row.tri];
            return p && Number.isFinite(p.points) ? <ProjRange p={p} lo={projRange[0]} hi={projRange[1]} /> : <Dash />;
        }
        default:
            return undefined;
    }
}

/** One line: what bold and dim mean, the thin-sample rule, and (when they exist) the clinch codes. */
function Legend({ clinch }: { clinch: boolean }) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-fg-3">
            <span>
                <b className="font-semibold text-fg-1">Bold</b> top 5
            </span>
            <span>Dim bottom 5</span>
            <span>
                Dim PP% / PK% under {THIN_CHANCES} chances; ranks start at {EMPHASIS_MIN_GP} GP
            </span>
            {clinch
                ? (['x', 'y', 'z', 'p', 'e'] as const).map(c => (
                      <span key={c} className="inline-flex items-center gap-1 uppercase tracking-label">
                          <b className={c === 'e' ? 'text-neg' : 'text-pos'}>{c}</b>
                          {CLINCH_SHORT[c]}
                      </span>
                  ))
                : null}
        </div>
    );
}

const CLINCH_SHORT: Record<string, string> = { x: 'Playoffs', y: 'Conf', z: 'Div', p: 'Pres', e: 'Out' };

/** One filter control; its label is the accessible name (the options read for themselves). In the phone sheet it is a labelled Field. */
function Group({ label, sheet, children }: { label: string; sheet?: boolean; children: React.ReactNode }) {
    if (sheet) return <Field label={label}>{children}</Field>;
    return (
        <div role="group" aria-label={label} className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="text-micro font-medium uppercase tracking-label text-fg-3">
                {label}
            </span>
            {children}
        </div>
    );
}

/** Any per-game filter set (the Per game chip lights up even while its panel is closed). */
const hasPerGame = (f: TableFilters) => f.ppg !== 'All' || f.ppga !== 'All' || f.scoredFirst !== 'All' || Object.values(f.ranges).some(v => v && (v[0] !== '' || v[1] !== ''));

const CHIP = 'min-h-7 px-2.5 tracking-wide coarse:min-h-9';

/**
 * Every filter, always on screen from lg up: no drawer, no extra taps.
 * Per-game filters (PP goal, first goal, ranges) open inline under the bar.
 * On phones the same controls stack in a bottom sheet (`sheet`).
 */
function FilterBar({
    filters, setF, setFilters, allowPlayoffs, allowBracket, chips, perGameOpen, sheet,
}: {
    filters: TableFilters;
    setF: <K extends keyof TableFilters>(k: K, v: TableFilters[K]) => void;
    setFilters: React.Dispatch<React.SetStateAction<TableFilters>>;
    allowPlayoffs: boolean;
    allowBracket: boolean;
    chips: { key: string; label: string; clear: () => void }[];
    perGameOpen: boolean;
    sheet?: boolean;
}) {
    const more = perGameOpen;
    const views: { value: TableView; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'today', label: 'Today' },
        { value: 'tomorrow', label: 'Tomorrow' },
        ...(allowBracket ? [{ value: 'bracket' as const, label: 'Bracket' }] : []),
    ];
    const pairedView = filters.view === 'today' || filters.view === 'tomorrow';
    const chipCls = sheet ? undefined : CHIP;
    const controls = (
        <>
            {allowPlayoffs ? (
                <Group label="Games" sheet={sheet}>
                    <Segmented
                        label="Games"
                        size="sm"
                        block={sheet}
                        value={filters.scope}
                        onChange={v => setF('scope', v)}
                        options={[
                            { value: 'regular', label: 'Regular' },
                            { value: 'playoffs', label: 'Playoffs' },
                        ]}
                    />
                </Group>
            ) : null}
            <Group label="Teams" sheet={sheet}>
                <Segmented label="Teams" size="sm" block={sheet} value={filters.view} onChange={v => setF('view', v)} options={views} />
            </Group>
            <Group label="Location" sheet={sheet}>
                <Segmented
                    label="Location"
                    size="sm"
                    block={sheet}
                    value={filters.location}
                    onChange={v => setF('location', v)}
                    options={[
                        { value: 'All', label: 'All' },
                        { value: 'Home', label: 'Home' },
                        { value: 'Away', label: 'Away' },
                    ]}
                />
            </Group>
            <Group label="Recent" sheet={sheet}>
                <Segmented
                    label="Recent"
                    size="sm"
                    block={sheet}
                    value={String(filters.recent)}
                    onChange={v => setF('recent', (v === 'All' ? 'All' : Number(v)) as Recent)}
                    options={[
                        { value: 'All', label: 'Season' },
                        { value: '5', label: 'L5' },
                        { value: '10', label: 'L10' },
                        { value: '20', label: 'L20' },
                    ]}
                />
            </Group>
            <Group label="Period" sheet={sheet}>
                <Segmented
                    label="Period"
                    size="sm"
                    block={sheet}
                    value={filters.period}
                    onChange={v => setF('period', v)}
                    options={(['All', '1st', '2nd', '3rd', 'OT'] as PeriodFilter[]).map(p => ({ value: p, label: p === 'All' ? 'Game' : p }))}
                />
            </Group>
            <Group label="Playoff spot" sheet={sheet}>
                <Segmented
                    label="Playoff spot"
                    size="sm"
                    block={sheet}
                    value={filters.position}
                    onChange={v => setF('position', v)}
                    options={[
                        { value: 'All', label: 'All' },
                        { value: 'In', label: 'In' },
                        { value: 'Out', label: 'Out' },
                    ]}
                />
            </Group>
            <Group label="Division" sheet={sheet}>
                <div role="group" aria-label="Division" className={cn('flex flex-wrap', sheet ? 'gap-1.5' : 'gap-1')}>
                    {DIVISIONS.map(d => (
                        <FilterChip
                            key={d}
                            className={chipCls}
                            selected={filters.divisions.includes(d)}
                            onSelectedChange={() => setF('divisions', filters.divisions.includes(d) ? filters.divisions.filter(x => x !== d) : [...filters.divisions, d])}
                        >
                            <span title={DIVISION_LABEL[d]}>{DIVISION_LABEL[d].slice(0, 3)}</span>
                        </FilterChip>
                    ))}
                </div>
            </Group>
            {pairedView ? (
                <Group label="Split by" sheet={sheet}>
                    <div role="group" aria-label="Split by" className="flex flex-wrap gap-1.5">
                        {([['withLocation', 'Home/Away'], ['withStarter', 'Starter'], ['withDow', 'Weekday']] as const).map(([k, label]) => (
                            <FilterChip key={k} className={chipCls} selected={filters[k]} onSelectedChange={() => setFilters(f => ({ ...f, [k]: !f[k] }))}>
                                {label}
                            </FilterChip>
                        ))}
                    </div>
                </Group>
            ) : null}
        </>
    );
    const perGame = ([['ppg', 'PP goal', ['Any', 'Yes', 'No']], ['ppga', 'PP goal against', ['Any', 'Yes', 'No']], ['scoredFirst', 'First goal', ['Any', 'For', 'Against']]] as const).map(([k, label, names]) => (
        <Group key={k} label={label} sheet={sheet}>
            <Segmented
                label={label}
                size="sm"
                block={sheet}
                value={filters[k]}
                onChange={v => setF(k, v)}
                options={(['All', 'Yes', 'No'] as const).map((value, i) => ({ value, label: names[i] }))}
            />
        </Group>
    ));
    const ranges = <RangeFields ranges={filters.ranges} onChange={(k, v) => setFilters(f => ({ ...f, ranges: { ...f.ranges, [k]: v } }))} />;

    if (sheet) {
        return (
            <div>
                {controls}
                {perGame}
                <div className="py-3">{ranges}</div>
            </div>
        );
    }
    return (
        <div className="hidden flex-col gap-2 lg:flex">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{controls}</div>
            {more ? (
                <div className="panel flex flex-col gap-3 px-3 py-3">
                    <div className="flex flex-wrap gap-x-5 gap-y-2.5">{perGame}</div>
                    {ranges}
                </div>
            ) : null}
            {chips.length > 0 ? <ActiveChips chips={chips} /> : null}
        </div>
    );
}

/** The removable summary of every active filter. */
function ActiveChips({ chips }: { chips: { key: string; label: string; clear: () => void }[] }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {chips.map(c => (
                <FilterChip key={c.key} className={CHIP} selected removable onClick={c.clear} aria-label={`Remove filter: ${c.label}`}>
                    {c.label}
                </FilterChip>
            ))}
        </div>
    );
}

/** The All lens's column chooser: the default set or everything, and chips to hide or show single columns. */
function ColumnPicker({
    hidden, setHidden, ratingsMissing, extra, sheet,
}: {
    hidden: string[];
    setHidden: React.Dispatch<React.SetStateAction<string[]>>;
    ratingsMissing: boolean;
    extra?: React.ReactNode;
    /** Phone sheet: presets, then every group's chips, always open. */
    sheet?: boolean;
}) {
    const [isOpen, setOpen] = React.useState(false);
    const open = sheet || isOpen;
    const hiddenSet = new Set(hidden);
    const allKeys = COLUMN_GROUPS.flatMap(g => g.cols).filter(k => !(ratingsMissing && COLUMN_BY_KEY.get(k)?.rating));
    const shown = allKeys.filter(k => !hiddenSet.has(k)).length;
    const toggle = (k: string) => setHidden(h => (h.includes(k) ? h.filter(x => x !== k) : [...h, k]));
    const setGroup = (cols: string[], on: boolean) => setHidden(h => (on ? h.filter(k => !cols.includes(k)) : [...new Set([...h, ...cols])]));
    const isPreset = (cols: string[]) => allKeys.every(k => cols.includes(k) === !hiddenSet.has(k));
    const chipCls = sheet ? undefined : CHIP;
    const presets = (
        <>
            <FilterChip className={chipCls} selected={isPreset(allKeys.filter(k => !DEFAULT_HIDDEN.includes(k)))} onSelectedChange={() => setHidden(DEFAULT_HIDDEN)}>
                Default
            </FilterChip>
            <FilterChip className={chipCls} selected={hidden.length === 0} onSelectedChange={() => setHidden([])}>
                All
            </FilterChip>
        </>
    );
    return (
        <div className={sheet ? 'flex flex-col' : 'hidden flex-col gap-2 lg:flex'}>
            {sheet ? (
                <Field label="Preset">
                    <div className="flex flex-wrap gap-1.5">{presets}</div>
                </Field>
            ) : (
                <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-micro uppercase tracking-wide text-fg-3">Columns</span>
                    {presets}
                    <span className="ml-auto flex items-center gap-1">
                        {extra}
                        <FilterChip className={CHIP} selected={open} onSelectedChange={setOpen} aria-expanded={open} count={shown}>
                            Customize
                        </FilterChip>
                    </span>
                </div>
            )}
            {open ? (
                <div className={cn('grid gap-x-6', sheet ? 'gap-y-4 py-3' : 'panel gap-y-3 px-3 py-3 md:grid-cols-2 xl:grid-cols-3')}>
                    {COLUMN_GROUPS.map(g => {
                        const cols = g.cols.filter(k => !(ratingsMissing && COLUMN_BY_KEY.get(k)?.rating));
                        if (!cols.length) return null;
                        const on = cols.every(k => !hiddenSet.has(k));
                        return (
                            <div key={g.name} role="group" aria-label={g.name} className="flex flex-col gap-1.5">
                                <button type="button" onClick={() => setGroup(cols, !on)} className={cn('self-start text-micro font-medium uppercase tracking-wide text-fg-2 hover:text-fg-1', sheet && 'min-h-10')}>
                                    {g.name} <span className="text-fg-3">{on ? '· hide all' : '· show all'}</span>
                                </button>
                                <div className="flex flex-wrap gap-1">
                                    {cols.map(k => {
                                        const c = COLUMN_BY_KEY.get(k)!;
                                        return (
                                            <FilterChip key={k} className={cn('min-h-6 px-2 !tracking-wide', sheet && 'min-w-11 justify-center')} selected={!hiddenSet.has(k)} onSelectedChange={() => toggle(k)} title={c.title}>
                                                {c.label}
                                            </FilterChip>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}

/** `complete`: one chip per counted filter (phones, where the controls sit in a sheet); the desktop bar shows its own controls for location and L10. */
function activeChips(f: TableFilters, set: React.Dispatch<React.SetStateAction<TableFilters>>, complete = false) {
    const out: { key: string; label: string; clear: () => void }[] = [];
    const reset = <K extends keyof TableFilters>(k: K) => () => set(prev => ({ ...prev, [k]: DEFAULT_FILTERS[k] }));
    // The desktop bar shows every segmented control, so only filters hidden behind Per game get a chip there.
    if (complete && f.scope !== 'regular') out.push({ key: 'scope', label: 'Playoffs', clear: reset('scope') });
    if (complete && f.view !== 'all') out.push({ key: 'view', label: f.view === 'today' ? 'Today' : f.view === 'tomorrow' ? 'Tomorrow' : 'Bracket', clear: reset('view') });
    if (complete && f.location !== 'All') out.push({ key: 'location', label: f.location, clear: reset('location') });
    if (complete && f.recent !== 'All') out.push({ key: 'recent', label: `L${f.recent}`, clear: reset('recent') });
    if (complete && f.period !== 'All') out.push({ key: 'period', label: f.period, clear: reset('period') });
    if (complete && f.divisions.length) out.push({ key: 'divisions', label: f.divisions.map(d => DIVISION_LABEL[d]).join('+'), clear: () => set(prev => ({ ...prev, divisions: [] })) });
    if (complete && f.position !== 'All') out.push({ key: 'position', label: f.position === 'In' ? 'In spot' : 'Out of spot', clear: reset('position') });
    if (f.ppg !== 'All') out.push({ key: 'ppg', label: f.ppg === 'Yes' ? 'PPG' : 'No PPG', clear: reset('ppg') });
    if (f.ppga !== 'All') out.push({ key: 'ppga', label: f.ppga === 'Yes' ? 'PPGA' : 'No PPGA', clear: reset('ppga') });
    if (f.scoredFirst !== 'All') out.push({ key: 'sfirst', label: f.scoredFirst === 'Yes' ? 'Scored 1st' : 'Trailed 1st', clear: reset('scoredFirst') });
    for (const [k, v] of Object.entries(f.ranges)) {
        if (!v || (v[0] === '' && v[1] === '')) continue;
        const label = `${k.toUpperCase()} ${v[0] !== '' ? `≥${v[0]}` : ''}${v[0] !== '' && v[1] !== '' ? ' ' : ''}${v[1] !== '' ? `≤${v[1]}` : ''}`;
        out.push({
            key: `r-${k}`,
            label,
            clear: () =>
                set(prev => {
                    const ranges = { ...prev.ranges };
                    delete ranges[k as keyof typeof ranges];
                    return { ...prev, ranges };
                }),
        });
    }
    return out;
}
