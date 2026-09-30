import { cn } from '@/lib/utils';

export type GoalieGlyphTone = 'conf' | 'likely' | 'proj';

/**
 * Word-free starter status cue before a goalie's surname, so the status is
 * not carried by colour alone (WCAG 1.4.1): a filled dot = confirmed, a
 * hollow ring = likely, nothing = projected. Drawn in currentColor, so it
 * takes the name's green / faded green. Also used by /methodology's sample card.
 */
export function GoalieGlyph({ tone, className }: { tone: GoalieGlyphTone; className?: string }) {
    if (tone === 'proj') return null;
    return (
        <span
            aria-hidden="true"
            data-goalie-glyph={tone}
            className={cn(
                'mr-[0.35em] inline-block h-1.5 w-1.5 shrink-0 translate-y-[-0.15em] rounded-full align-middle',
                tone === 'conf' ? 'bg-current' : 'border-[1.5px] border-current',
                className,
            )}
        />
    );
}

export default GoalieGlyph;
