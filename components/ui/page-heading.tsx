import * as React from 'react';
import { cn } from '../../lib/utils';

export interface PageHeadingProps {
    /** The page's single h1: the page name, nothing else. */
    title: React.ReactNode;
    /** Tiny mono tag beside the title, e.g. a muted "25-26" when the page shows last season. */
    tag?: React.ReactNode;
    /** Keep the h1 for screen readers / outline only (e.g. the home slate). */
    visuallyHidden?: boolean;
    /** Right-aligned controls on the same row (date chips, season switcher, legend …). */
    actions?: React.ReactNode;
    className?: string;
    id?: string;
    /**
     * @deprecated Not rendered. Page tops carry the page name only; explanations
     * live on /methodology. Remove from call sites.
     */
    eyebrow?: React.ReactNode;
    /** @deprecated Not rendered (see `eyebrow`). */
    description?: React.ReactNode;
}

/**
 * The page heading: the page name in uppercase display type, optionally a
 * row of controls to its right. No eyebrow, no tagline, no subtitle.
 * Every page renders exactly one (the "h1 slot").
 */
export function PageHeading({ title, tag, visuallyHidden, actions, className, id }: PageHeadingProps) {
    if (visuallyHidden) {
        return (
            <h1 id={id} className="sr-only">
                {title}
            </h1>
        );
    }
    return (
        <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-3', className)}>
            <h1 id={id} className="heading-page flex items-center gap-3">
                {title}
                {tag ? <span className="rounded-chip border border-mute px-1.5 py-0.5 font-sans text-micro font-medium tracking-wide text-fg-3">{tag}</span> : null}
            </h1>
            {actions ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
    );
}

export default PageHeading;
