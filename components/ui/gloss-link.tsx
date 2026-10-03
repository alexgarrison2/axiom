import * as React from 'react';
import { glossaryHref } from '@/lib/glossary-href';
import { cn } from '@/lib/utils';

/**
 * A terse label that opens its /methodology explanation. Titles do nothing on
 * touch or for keyboard users, so the label itself is the link: the title
 * stays for mouse hover and the same text rides along as sr-only, adding no
 * visible words. Never put one inside another interactive element.
 */
export function GlossLink({
    term,
    href,
    title,
    desc,
    className,
    children,
}: {
    /** Glossary id (→ /methodology#term-<id>). */
    term?: string;
    /** Explicit target when it is a section, e.g. "/methodology#edge". */
    href?: string;
    /** Hover text. Defaults to `desc`. */
    title?: string;
    /** Screen-reader explanation, read after the label. */
    desc?: string;
    className?: string;
    children: React.ReactNode;
}) {
    const target = href ?? (term ? glossaryHref(term) : '/methodology#glossary');
    const hover = title ?? desc;
    return (
        <a
            href={target}
            title={hover || undefined}
            data-gloss={term ?? target.split('#')[1]}
            className={cn(
                'relative inline-flex min-h-6 items-center rounded-chip underline decoration-fg-3 decoration-dotted underline-offset-[3px] transition-colors hover:decoration-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
                className,
            )}
        >
            {children}
            {desc ? <span className="sr-only"> ({desc})</span> : null}
        </a>
    );
}
