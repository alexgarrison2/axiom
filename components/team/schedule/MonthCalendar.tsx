'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Globe2, Moon, Snowflake, Sun } from 'lucide-react';
import type { SchedGame } from '@/lib/schedule/metrics';
import { cn } from '@/lib/utils';
import { inFocus, inLens, monthLong, type Focus, type Lens } from './schedule-ui';

interface MonthCalendarProps {
    month: string;
    months: string[];
    games: SchedGame[];
    focus: Focus;
    lens: Lens;
    today: string;
    teamColor: string;
    selectedId: number | null;
    onSelect: (id: number) => void;
    onHover: (id: number | null) => void;
    onMonth: (key: string) => void;
}

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function resultText(g: SchedGame): { text: string; tone: string } | null {
    if (!g.result) return null;
    const r = g.result;
    const code = r.code === 'W' ? 'W' : r.code === 'OTL' ? (r.ot === 'SO' ? 'SOL' : 'OTL') : 'L';
    return { text: `${code} ${r.gf}-${r.ga}`, tone: r.code === 'W' ? 'text-pos' : 'text-neg' };
}

/** One icon at most per day: the special venue, else an odd start. */
function DayIcon({ g }: { g: SchedGame }) {
    const cls = 'h-3 w-3 text-warn';
    if (g.event?.kind === 'outdoor') return <Snowflake aria-hidden="true" className={cls} />;
    if (g.event) return <Globe2 aria-hidden="true" className={cls} />;
    if (g.tags.includes('DAY')) return <Sun aria-hidden="true" className={cls} />;
    if (g.tags.includes('LATE')) return <Moon aria-hidden="true" className={cls} />;
    return null;
}

/**
 * A month of the schedule: each game day shows the opponent's crest, "@" for
 * road games, the result (or the model's win % for a game ahead, magenta),
 * and a small amber B2B on the second night of a back-to-back (the wider
 * 3-in-4 / 4-in-6 windows live in the rhythm strip and the game card). Home
 * days carry a faint wash of the team's colour.
 */
export function MonthCalendar({ month, months, games, focus, lens, today, teamColor, selectedId, onSelect, onHover, onMonth }: MonthCalendarProps) {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7)) - 1;
    const first = new Date(Date.UTC(y, m, 1));
    const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = first.getUTCDay();
    const byDate = React.useMemo(() => new Map(games.filter(g => g.date.startsWith(month)).map(g => [g.date, g])), [games, month]);
    const idx = months.indexOf(month);
    const prev = idx > 0 ? months[idx - 1] : null;
    const next = idx >= 0 && idx < months.length - 1 ? months[idx + 1] : null;

    const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
    while (cells.length % 7) cells.push(null);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    disabled={!prev}
                    onClick={() => prev && onMonth(prev)}
                    aria-label="Previous month"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-line text-fg-2 hover:border-line-strong hover:text-fg-1 disabled:opacity-30 coarse:h-11 coarse:w-11"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <h3 className="heading-sub" aria-live="polite">
                    {monthLong(month)} <span className="text-fg-3">{y}</span>
                </h3>
                <button
                    type="button"
                    disabled={!next}
                    onClick={() => next && onMonth(next)}
                    aria-label="Next month"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-line text-fg-2 hover:border-line-strong hover:text-fg-1 disabled:opacity-30 coarse:h-11 coarse:w-11"
                >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[10px] border border-line bg-line">
                {WEEK.map((d, i) => (
                    <div key={i} aria-hidden="true" className="bg-bg py-1 text-center text-micro font-medium text-fg-3">
                        {d}
                    </div>
                ))}
                {cells.map((day, i) => {
                    if (day == null) return <div key={`e-${i}`} className="bg-[var(--panel-bottom)]" />;
                    const date = `${month}-${String(day).padStart(2, '0')}`;
                    const g = byDate.get(date);
                    const isToday = date === today;
                    if (!g)
                        return (
                            <div key={date} className={cn('relative min-h-[58px] bg-[var(--panel-bottom)] p-1 md:min-h-[64px]', isToday && 'ring-1 ring-inset ring-brand/60')}>
                                <span className="text-micro tabular-nums text-fg-disabled">{day}</span>
                            </div>
                        );
                    const res = resultText(g);
                    const dim = !inFocus(g, focus) || !inLens(g, lens);
                    const picked = g.id === selectedId;
                    const label = `${g.home ? 'vs' : 'at'} ${g.opp}, ${date}${g.b2b ? ', back-to-back' : ''}${res ? `, ${res.text}` : g.winPct ? `, model ${Math.round(g.winPct.pct)}%` : ''}`;
                    return (
                        <button
                            key={date}
                            type="button"
                            aria-label={label}
                            aria-pressed={picked}
                            onClick={() => onSelect(g.id)}
                            onPointerEnter={e => e.pointerType === 'mouse' && onHover(g.id)}
                            onPointerLeave={e => e.pointerType === 'mouse' && onHover(null)}
                            className={cn(
                                'group relative flex min-h-[58px] flex-col items-center justify-between overflow-hidden bg-surface-1 px-0.5 pb-1.5 pt-1 text-left outline-none transition-opacity focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand md:min-h-[64px]',
                                dim && 'opacity-35',
                                picked && 'z-10 ring-2 ring-inset ring-brand',
                                !picked && isToday && 'ring-1 ring-inset ring-brand/60',
                            )}
                            style={!g.onRoad ? { backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${teamColor} 16%, transparent), transparent 75%)` } : undefined}
                        >
                            <span className="flex w-full items-center justify-between gap-0.5 px-0.5 text-micro leading-none tabular-nums max-sm:px-0">
                                <span className={cn('text-fg-3', picked && 'text-brand')}>
                                    {day}
                                    {g.home ? null : <span className="ml-0.5 text-fg-2">@</span>}
                                </span>
                                <span className="flex min-w-0 items-center gap-1">
                                    {g.b2b ? (
                                        <>
                                            <span className="font-semibold tracking-normal text-warn/80 max-[439px]:hidden sm:tracking-wide">B2B</span>
                                            {/* Phone cells are too narrow for the word: a small amber dot. */}
                                            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn/80 min-[440px]:hidden" />
                                        </>
                                    ) : null}
                                    <DayIcon g={g} />
                                </span>
                            </span>
                            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG crest */}
                            <img src={`/logos/${g.opp}.svg`} alt="" width={26} height={26} decoding="async" className="h-[24px] w-[24px] object-contain md:h-[28px] md:w-[28px]" />
                            <span className="text-micro font-semibold leading-none tabular-nums">
                                {res ? (
                                    <span className={res.tone}>
                                        <span className="max-[380px]:hidden">{res.text}</span>
                                        <span className="min-[381px]:hidden">{res.text.split(' ')[0]}</span>
                                    </span>
                                ) : g.winPct ? (
                                    <span className="text-model">{Math.round(g.winPct.pct)}%</span>
                                ) : (
                                    <span className="text-fg-3">{g.et.replace(/:00/, '').replace(/ (AM|PM)/, '')}</span>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default MonthCalendar;
