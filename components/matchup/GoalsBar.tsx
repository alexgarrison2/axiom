import { GlossLink } from '@/components/ui/gloss-link';
import { Crest } from '@/components/ui/crest';
import { pctInk } from '@/components/ui/win-bar';
import { cn } from '@/lib/utils';

const GOAL_SCALE = 9;

/**
 * Projected goals on a goal axis, in the win bar's own language: each team's xG
 * stacked end to end (gradient, hatch, the heavier side lit), a white tick at the
 * posted total. Over/under reads as whether the bar passes the tick.
 */
export function GoalsBar({ away, home, ax, hx, line, colors }: { away: string; home: string; ax: number; hx: number; line: string | null; colors: { away: string; home: string } }) {
    const total = ax + hx;
    const lineN = line != null ? Number(line) : null;
    const pos = (g: number) => Math.min(100, (g / GOAL_SCALE) * 100);
    const diff = lineN != null ? total - lineN : null;
    const lean = diff == null ? null : Math.abs(diff) < 0.25 ? 'On the line' : diff > 0 ? `Over by ${diff.toFixed(1)}` : `Under by ${Math.abs(diff).toFixed(1)}`;
    const awayLead = ax >= hx;
    const seg = (side: 'away' | 'home') => {
        const tri = side === 'away' ? away : home;
        const val = side === 'away' ? ax : hx;
        const fill = colors[side];
        const lead = side === 'away' ? awayLead : !awayLead;
        const ink = pctInk(fill, !lead).ink;
        return (
            <span
                aria-hidden="true"
                className={cn('absolute inset-y-0 flex items-center gap-1.5 overflow-hidden px-1.5', side === 'away' ? 'left-0 rounded-l-bar' : 'rounded-r-bar')}
                style={{
                    left: side === 'home' ? `${pos(ax)}%` : undefined,
                    width: `${pos(val)}%`,
                    backgroundColor: fill,
                    backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${fill} 70%, #000), ${fill})`,
                    boxShadow: lead ? `0 0 26px -4px ${fill}` : undefined,
                    filter: lead ? undefined : 'saturate(.55) brightness(.75)',
                    color: ink,
                }}
            >
                <span className="wb-hatch absolute inset-0" />
                <Crest tri={tri} size={28} className="relative drop-shadow-none" />
                <span className="num-pct relative text-[20px] leading-none">{val.toFixed(2)}</span>
            </span>
        );
    };
    return (
        <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex items-baseline justify-between text-micro font-medium uppercase tracking-wide text-fg-3">
                <GlossLink term="projected-goals">xG</GlossLink>
                <span className="tabular-nums">
                    <span className="num-pct text-title text-fg-1">{total.toFixed(2)}</span>
                    {lineN != null ? (
                        <>
                            {' '}
                            vs {lineN} · {lean}
                        </>
                    ) : null}
                </span>
            </div>
            <div
                role="img"
                aria-label={`Projected goals: ${away} ${ax.toFixed(2)}, ${home} ${hx.toFixed(2)}, total ${total.toFixed(2)}${lineN != null ? ` against a line of ${lineN}` : ''}`}
                className="relative h-10 w-full rounded-bar bg-track"
            >
                {seg('away')}
                {seg('home')}
                {lineN != null ? (
                    <span aria-hidden="true" className="pointer-events-none absolute -bottom-[5px] -top-[5px] -ml-px w-0.5" style={{ left: `${pos(lineN)}%` }}>
                        <span className="block h-full w-full bg-white shadow-[0_0_8px_rgba(255,255,255,.8)]" />
                    </span>
                ) : null}
            </div>
            <div aria-hidden="true" className="relative h-3 text-micro tabular-nums text-fg-3">
                {lineN != null ? (
                    <span className="absolute -translate-x-1/2 font-bold text-fg-1" style={{ left: `${pos(lineN)}%` }}>
                        {lineN}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

export default GoalsBar;
