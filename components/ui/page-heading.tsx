import * as React from 'react';
import { cn } from '../../lib/utils';

export interface PageHeadingProps {
    /** The page's single h1. */
    title: React.ReactNode;
    /** Small uppercase label above the title (e.g. "2026-27 season"). */
    eyebrow?: React.ReactNode;
    description?: React.ReactNode;
    /** Keep the h1 for screen readers / outline only (e.g. the home slate). */
    visuallyHidden?: boolean;
    /** Right-aligned actions (filters, season switcher …). */
    actions?: React.ReactNode;
    className?: string;
    id?: string;
}

/**
 * Every page renders exactly one of these (the "h1 slot"). Use
 * `visuallyHidden` when the page's visual header is something else.
 */
export function PageHeading({ title, eyebrow, description, visuallyHidden, actions, className, id }: PageHeadingProps) {
    if (visuallyHidden) {
        return (
            <h1 id={id} className="sr-only">
                {title}
            </h1>
        );
    }
    return (
        <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
            <div className="min-w-0">
                {eyebrow ? <p className="hud-label mb-1 text-brand">{eyebrow}</p> : null}
                <h1 id={id} className="text-h2 font-black tracking-tight text-fg-1 md:text-display">
                    {title}
                </h1>
                {description ? <p className="mt-1 max-w-2xl text-body text-fg-2">{description}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
    );
}

export default PageHeading;
