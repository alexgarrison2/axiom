import { cn } from '@/lib/utils';
import { signed } from '@/lib/pony/parts';
import { fmtRating, ponyRating, ponyTier } from '@/lib/pony/rating';

/** One game's 0-10 Pony Rating in its tier colour; the tier and the score behind it on hover. */
export function RatingFigure({ score, pos, unit, className }: { score: number; pos: string; unit: string; className?: string }) {
    const r = ponyRating(score, pos);
    const t = ponyTier(r);
    return (
        <span className={cn('text-right font-display text-body font-bold tabular-nums', t.className, className)} title={`${t.label} · ${signed(score)} ${unit}`}>
            {fmtRating(r)}
        </span>
    );
}
