'use client';

import { Crest } from '@/components/ui/crest';
import { PlayerLink } from '@/components/players/PlayerLink';
import { teamColor } from '@/components/ui/team-color';
import { fmtInt, fmtNum } from '@/components/views/format';
import { dayLabel, describe, needUnit, type Milestone, type MilestonesDoc } from '@/lib/milestones';
import { LedNumber } from './LedNumber';
import { GameChip, HofTag, Ladder, Meter, OutTag, ThinTag } from './parts';

const needValue = (m: Milestone) => (m.stat === 'ixg' ? m.need.toFixed(2) : fmtInt(m.need));
const ledValue = (m: Milestone) => (m.stat === 'ixg' ? m.need.toFixed(2) : String(m.need));
const rateText = (m: Milestone) =>
    m.stat === 'gstreak' ? 'a goal a game'
        : m.stat === 'pstreak' ? 'a point a game'
            : m.stat === 'gp' || m.stat === 'ironman' ? 'every game'
                : `${m.rate < 1 ? m.rate.toFixed(2) : fmtNum(Math.round(m.rate * 10) / 10, 1)}/GP`;

/** One milestone on the board: who, what, how far, the projected game and his next game. */
export function MilestoneRow({ m, doc, sinceTag }: { m: Milestone; doc: Pick<MilestonesDoc, 'players' | 'next'>; sinceTag: string | null }) {
    const p = doc.players[String(m.p)];
    if (!p) return null;
    const [first, last, pos, team, out] = p;
    const c = describe(m, sinceTag);
    const [, date, opp, home, gameNo] = m.eta;
    const nextGame = doc.next[team];
    const isNext = nextGame?.[0] === m.eta[0];
    return (
        <li className="ms-row" style={{ '--tc': teamColor(team) } as React.CSSProperties}>
            <Crest tri={team} size={48} alt={team} className="ms-crest" />
            <div className="ms-who min-w-0">
                <p className="text-body font-bold leading-5 text-fg-1 lg:truncate">
                    <PlayerLink id={m.p}>
                        <span className="md:hidden">{first.charAt(0)}. </span>
                        <span className="max-md:hidden">{first} </span>
                        {last}
                    </PlayerLink>
                </p>
                <p className="flex items-center gap-1.5 whitespace-nowrap text-micro uppercase tracking-label text-fg-3">
                    {pos} · {team} <OutTag tag={out} />
                </p>
            </div>
            <div className="ms-what min-w-0">
                <p className="truncate text-title font-bold text-fg-1">
                    {c.title}
                    {c.hof ? <HofTag /> : null}
                </p>
                <p className="truncate text-caption text-fg-3">{c.context}</p>
            </div>
            <Ladder m={m} name={`${first} ${last}`} className="ms-ladder" />
            <div className="ms-count">
                <p className="flex items-end justify-end gap-1.5 lg:justify-start">
                    {/* Scoreboard cells up to four characters; bigger gaps in plain figures. */}
                    {ledValue(m).length <= 4 ? <LedNumber value={ledValue(m)} still className="h-5 lg:h-6" /> : <span className="num-score text-h2 leading-none text-fg-1">{needValue(m)}</span>}
                    <span className="sr-only">{needValue(m)}</span>
                    <span className="text-micro uppercase leading-none tracking-label text-fg-3">{needUnit(m)}</span>
                </p>
                <Meter m={m} className="ml-auto mt-2 w-16 lg:ml-0 lg:w-[84px]" />
            </div>
            <div className="ms-when min-w-0 text-caption">
                <p className="whitespace-nowrap text-model">
                    <span className="font-bold">G{gameNo}</span> · {isNext ? 'next game' : dayLabel(date)}
                    {isNext ? null : <span className="text-fg-3"> {home ? 'vs' : '@'} {opp}</span>}
                    <span className="text-fg-3"> · {rateText(m)}</span> <ThinTag n={m.n} />
                </p>
                <p className="mt-1 flex items-center gap-2">
                    <span className="label">Next</span>
                    <GameChip game={nextGame} />
                </p>
            </div>
        </li>
    );
}
