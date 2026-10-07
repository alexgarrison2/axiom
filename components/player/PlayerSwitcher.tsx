'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Switcher } from '@/components/Switcher';
import { Crest } from '@/components/ui/crest';
import { cn } from '@/lib/utils';
import { decodeIndex, GROUP_LABEL, playerHref, searchPlayers, teamRoster, type IndexPlayer, type PlayersIndexDoc } from '@/lib/players/switcher';

interface PlayerSwitcherProps {
    /** The player being viewed. */
    current: number;
    name: string;
    /** His current team: the default list is its roster. */
    team: string | null;
    className?: string;
}

// One index per page load, fetched on the first hover / focus / open of the trigger.
let indexLoad: Promise<IndexPlayer[]> | null = null;
let indexData: IndexPlayer[] | null = null;
function loadIndex(): Promise<IndexPlayer[]> {
    indexLoad ??= fetch('/api/players-index')
        .then(r => (r.ok ? (r.json() as Promise<PlayersIndexDoc>) : Promise.reject(new Error(String(r.status)))))
        .then(doc => (indexData = decodeIndex(doc)))
        .catch((e: unknown) => {
            indexLoad = null;
            throw e;
        });
    return indexLoad;
}
const prefetch = () => void loadIndex().catch(() => {});

/**
 * Player switcher: the team page's SWITCH panel, listing his teammates
 * (forwards, defence, goalies by number) until a name is typed, then every
 * player in the last two seasons by best match. Arrow keys move, Enter goes;
 * links keep ?season= when the target played that season.
 */
export default function PlayerSwitcher({ current, name, team, className }: PlayerSwitcherProps) {
    const router = useRouter();
    const listId = React.useId();
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState('');
    const [season, setSeason] = React.useState<string | null>(null);
    const [players, setPlayers] = React.useState<IndexPlayer[] | null>(indexData);
    const [failed, setFailed] = React.useState(false);
    const [active, setActive] = React.useState(-1);

    const onOpenChange = (o: boolean) => {
        setOpen(o);
        if (!o) return;
        setQ('');
        setActive(-1);
        try {
            setSeason(new URLSearchParams(window.location.search).get('season'));
        } catch {
            setSeason(null);
        }
        if (indexData) setPlayers(indexData);
        else {
            setFailed(false);
            loadIndex().then(setPlayers, () => setFailed(true));
        }
    };

    const searching = q.trim() !== '';
    const groups = React.useMemo(() => {
        if (!players) return [];
        const list: { key: string; label: string | null; players: IndexPlayer[] }[] = searching
            ? [{ key: 'hits', label: null, players: searchPlayers(players, q) }]
            : teamRoster(players, team).map(g => ({ key: g.group, label: GROUP_LABEL[g.group], players: g.players }));
        // Each group's first index in the flat keyboard order.
        let start = 0;
        return list.map(g => ({ ...g, start: (start += g.players.length) - g.players.length }));
    }, [players, q, searching, team]);
    const flat = React.useMemo(() => groups.flatMap(g => g.players), [groups]);
    const optId = (i: number) => `${listId}-o${i}`;

    const onQuery = (v: string) => {
        setQ(v);
        setActive(v.trim() ? 0 : -1);
    };

    const go = (p: IndexPlayer) => {
        setOpen(false);
        router.push(playerHref(p, season));
    };

    React.useEffect(() => {
        if (active >= 0) document.getElementById(`${listId}-o${active}`)?.scrollIntoView({ block: 'nearest' });
    }, [active, listId]);

    const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!flat.length) return;
        const t = e.target as HTMLElement;
        const inList = t.tagName === 'INPUT' || t.getAttribute('role') === 'dialog' || t === e.currentTarget;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(a => Math.min(a + 1, flat.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(a => Math.max(a - 1, 0));
        } else if (e.key === 'Enter' && inList && active >= 0 && flat[active]) {
            e.preventDefault();
            go(flat[active]);
        }
    };

    return (
        <Switcher
            open={open}
            onOpenChange={onOpenChange}
            triggerLabel={`Switch player (current: ${name})`}
            triggerProps={{ onPointerEnter: prefetch, onFocus: prefetch, onPointerDown: prefetch }}
            className={className}
            panelLabel="Choose a player"
            panelClassName="md:w-[420px] md:max-h-[min(80vh,640px,var(--radix-popover-content-available-height))]"
            onPanelKeyDown={onPanelKeyDown}
            query={q}
            onQuery={onQuery}
            searchLabel="Search players"
            inputProps={{
                role: 'combobox',
                'aria-expanded': true,
                'aria-controls': listId,
                'aria-autocomplete': 'list',
                'aria-activedescendant': active >= 0 && flat[active] ? optId(active) : undefined,
                autoComplete: 'off',
                autoCorrect: 'off',
                autoCapitalize: 'off',
                spellCheck: false,
                enterKeyHint: 'go',
            }}
        >
            <div id={listId} role="listbox" aria-label={searching ? 'Players' : 'Teammates'} className="flex flex-col gap-3">
                {groups.map(g => (
                    <div key={g.key} role="group" aria-labelledby={g.label ? `${listId}-${g.key}` : undefined} aria-label={g.label ? undefined : 'Matches'}>
                        {g.label ? (
                            <p id={`${listId}-${g.key}`} className="label mb-1 px-2">
                                {g.label}
                            </p>
                        ) : null}
                        {g.players.map((p, n) => {
                            const k = g.start + n;
                            const isCur = p.id === current;
                            return (
                                <Link
                                    key={p.id}
                                    id={optId(k)}
                                    role="option"
                                    aria-selected={k === active}
                                    aria-current={isCur ? 'page' : undefined}
                                    tabIndex={-1}
                                    href={playerHref(p, season)}
                                    onClick={() => setOpen(false)}
                                    onMouseMove={() => k !== active && setActive(k)}
                                    className={cn(
                                        'flex min-h-9 items-center gap-2.5 rounded-control px-2 text-caption transition-colors coarse:min-h-11',
                                        isCur ? 'bg-surface-3 text-brand' : 'text-fg-2',
                                        k === active && (isCur ? 'ring-1 ring-inset ring-line-strong' : 'bg-surface-2 text-fg-1'),
                                    )}
                                >
                                    <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-surface-2">
                                        {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshot */}
                                        <img
                                            src={p.headshot}
                                            alt=""
                                            width={28}
                                            height={28}
                                            loading="lazy"
                                            decoding="async"
                                            className="headshot h-full w-full"
                                            onError={e => (e.currentTarget.style.visibility = 'hidden')}
                                        />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">
                                        {p.first ? <span className={isCur ? undefined : 'text-fg-3'}>{p.first} </span> : null}
                                        <span className={cn('font-bold', isCur ? 'text-brand' : 'text-fg-1')}>{p.last}</span>
                                    </span>
                                    {searching ? (
                                        <span className="flex shrink-0 items-center gap-1.5 text-micro font-bold text-fg-2">
                                            <Crest tri={p.team} size={20} className="drop-shadow-none" />
                                            <span className="w-8 max-[359px]:sr-only">{p.team}</span>
                                        </span>
                                    ) : null}
                                    <span className="w-4 shrink-0 text-center text-micro text-fg-3">{p.pos}</span>
                                    <span className="w-7 shrink-0 text-right text-micro text-fg-3">{p.num != null ? `#${p.num}` : ''}</span>
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </div>
            {players && searching && flat.length === 0 ? <p className="label px-2 py-6 text-center">No match</p> : null}
            {!players && !failed ? (
                <div aria-hidden="true" className="flex flex-col">
                    {Array.from({ length: 6 }, (_, n) => (
                        <div key={n} className="flex min-h-9 items-center gap-2.5 px-2 coarse:min-h-11">
                            <span className="h-7 w-7 rounded-full bg-surface-2" />
                            <span className="h-3 w-32 rounded-chip bg-surface-2" />
                        </div>
                    ))}
                </div>
            ) : null}
            {failed ? <p className="label px-2 py-6 text-center">Unavailable</p> : null}
        </Switcher>
    );
}
