'use client';

import type { CSSProperties } from 'react';
import type { Side, SideData } from '@/types/prediction';
import { fmtSv, goalieSeasonLine, lastName, vsOppTone } from '@/lib/matchup/format';
import type { CardChip } from '@/lib/matchup/pills';
import { glossaryHref } from '@/lib/glossary';
import { cn } from '@/lib/utils';
import styles from './slate.module.css';
import { GoalieGlyph } from './GoalieGlyph';
import { CHIP, OVER_TOGGLE } from './chip-styles';

export type GoalieTone = 'conf' | 'likely' | 'proj';

const STATUS: Record<string, { tone: GoalieTone; label: string }> = {
    Confirmed: { tone: 'conf', label: 'Confirmed' },
    Likely: { tone: 'likely', label: 'Likely' },
    'Probable (ESPN)': { tone: 'likely', label: 'Probable' },
    Unconfirmed: { tone: 'proj', label: 'Projected' },
};

/** Starter status: tone drives the name colour (green / faded green / grey). */
export function goalieStatus(s: string | null | undefined) {
    return STATUS[s ?? ''] ?? STATUS.Unconfirmed;
}

/** Goalie-name colour by status. Only a confirmed starter glows. */
export const GOALIE_TONE: Record<GoalieTone, string> = {
    conf: 'glow-green',
    likely: 'text-pos/75',
    proj: 'text-fg-2',
};

/** "25-26 19-12-8 .888 3.07" / "vs PHI 3-1-1 .941": tiny mono lines under the name. */
function StatLines({ s, opp, home }: { s: SideData; opp: string; home: boolean }) {
    const line = goalieSeasonLine(s);
    const vs = s.vsOpp;
    const tone = vsOppTone(vs);
    if (!line && !vs) return null;
    return (
        <span className={cn(styles.stats, styles.gstat, home ? 'items-end' : 'items-start')}>
            {line ? (
                <span className={cn('flex max-w-full flex-wrap items-center gap-x-[0.4em] gap-y-0.5 whitespace-nowrap', home && 'flex-row-reverse')}>
                    <span aria-hidden="true" className="flex gap-x-[0.4em]">
                        <span>{line.record}</span>
                        <span>{line.sv}</span>
                        <span>{line.gaa}</span>
                    </span>
                    {line.tag ? (
                        <span aria-hidden="true" className={styles.tag}>
                            {line.tag}
                        </span>
                    ) : null}
                    <span className="sr-only">
                        {line.tag ? `${line.tag} season` : 'This season'}: {line.record}, {line.sv} save percentage, {line.gaa} goals against average.
                    </span>
                </span>
            ) : null}
            {vs ? (
                <span className={cn('whitespace-nowrap', tone === 'good' ? 'font-bold text-pos' : tone === 'poor' ? 'font-bold text-neg' : 'text-fg-3')}>
                    <span aria-hidden="true">
                        vs {opp} {vs.record} {fmtSv(vs.sv)}
                    </span>
                    <span className="sr-only">
                        Career versus {opp}: {vs.record}, {fmtSv(vs.sv)} save percentage{tone ? ` (${tone === 'good' ? 'strong' : 'poor'} history)` : ''}.
                    </span>
                </span>
            ) : null}
        </span>
    );
}

/** A team's fatigue chip under its crest: a glossary link drawn above the card toggle. */
function SideChip({ chip }: { chip: CardChip }) {
    const body = (
        <>
            <span aria-hidden="true" className={CHIP}>
                {chip.label}
            </span>
            <span className="sr-only">{chip.title}</span>
        </>
    );
    return chip.term ? (
        <a href={glossaryHref(chip.term)} data-chip={chip.term} title={chip.title} className={cn(OVER_TOGGLE, 'px-0')}>
            {body}
        </a>
    ) : (
        <span title={chip.title} className="inline-flex min-h-6 items-center">
            {body}
        </span>
    );
}

/**
 * One side of the card: big crest on a team-colour wash (links to the team
 * page) with its fatigue chip under it, the starter's name in Chakra Petch
 * coloured by status, and the tiny season / vs-opponent lines. `faded` = the
 * loser of a final.
 */
export function TeamSide({
    side,
    s,
    opp,
    faded,
    chip,
    showStats = true,
}: {
    side: Side;
    s: SideData;
    opp: string;
    faded?: boolean;
    chip?: CardChip | null;
    showStats?: boolean;
}) {
    const home = side === 'home';
    const st = goalieStatus(s.goalieStatus);
    const src = s.goalieStatusSource === 'DFO' ? 'DailyFaceoff' : s.goalieStatusSource;
    return (
        <div className={cn(styles.side, home && styles.home)}>
            <span className={styles.crestSlot}>
                <a href={`/teams/${s.team.triCode}`} aria-label={`${s.team.name} team page`} className={cn(styles.crest, 'relative z-10 block rounded-full')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={s.team.logoUrl}
                        alt=""
                        width={84}
                        height={84}
                        decoding="async"
                        className={cn('h-full w-full object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,.65)] transition-transform duration-300 ease-out hover:scale-105 motion-reduce:transition-none', faded && 'opacity-50 grayscale-[40%]')}
                    />
                </a>
                {chip ? <SideChip chip={chip} /> : null}
            </span>
            <span
                className={cn(
                    styles.name,
                    'truncate font-display text-[15px] font-bold uppercase leading-5 tracking-[0.02em] cq-md:text-[18px] cq-md:leading-6',
                    s.goalie ? GOALIE_TONE[st.tone] : 'text-fg-2',
                    faded && 'opacity-60',
                )}
                title={s.goalie ? `${s.goalie} · ${st.label}${src ? ` (${src})` : ''}` : undefined}
            >
                {s.goalie ? <GoalieGlyph tone={st.tone} /> : null}
                {s.goalie ? lastName(s.goalie) : s.team.commonName}
                <span className="sr-only">{s.goalie ? `, ${s.team.commonName} goalie, ${st.label.toLowerCase()} starter` : ', starter not announced'}</span>
            </span>
            {showStats && s.goalie ? <StatLines s={s} opp={opp} home={home} /> : null}
        </div>
    );
}

/** Inline style for the card's crest wash: away / home team colours. */
export function washVars(away: string, home: string): CSSProperties {
    return { '--ac': away, '--hc': home } as CSSProperties;
}

export default TeamSide;
