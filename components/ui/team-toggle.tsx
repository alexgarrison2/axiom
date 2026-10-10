'use client';

import { Crest } from '@/components/ui/crest';
import { Segmented } from '@/components/ui/segmented';

export interface ToggleTeam<T extends string> {
    value: T;
    tri: string;
    /** Full name for screen readers; the tri-code otherwise. */
    name?: string;
}

/**
 * The one way to switch between teams (away / home, a traded player's clubs):
 * a segmented control whose options are the crest beside the tri-code.
 */
export function TeamToggle<T extends string>({
    value,
    onChange,
    teams,
    label = 'Team',
    block = false,
    className,
}: {
    value: T;
    onChange: (v: T) => void;
    teams: ToggleTeam<T>[];
    label?: string;
    block?: boolean;
    className?: string;
}) {
    return (
        <Segmented
            label={label}
            size="sm"
            block={block}
            value={value}
            onChange={onChange}
            className={className}
            optionClassName="gap-1.5 px-2.5"
            options={teams.map(t => ({
                value: t.value,
                label: (
                    <span className="flex items-center gap-1.5">
                        <Crest tri={t.tri} size={18} className="h-[18px] w-[18px]" />
                        {t.tri}
                    </span>
                ),
                ariaLabel: t.name ?? t.tri,
            }))}
        />
    );
}
