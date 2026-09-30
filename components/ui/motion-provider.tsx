'use client';

import * as React from 'react';
import { LazyMotion, MotionConfig, MotionGlobalConfig, domAnimation } from 'framer-motion';

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * With "reduce motion" on, skip every framer-motion animation outright: values
 * jump to their end state. `reducedMotion="user"` alone still plays opacity and
 * filter fades (e.g. a 1s blur-in on each card), which keeps content
 * invisible and animating. Set at module load so it applies before the first
 * component animates on hydration, and kept in sync if the OS setting changes.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia(REDUCE_QUERY);
    MotionGlobalConfig.skipAnimations = mq.matches;
    mq.addEventListener?.('change', e => {
        MotionGlobalConfig.skipAnimations = e.matches;
    });
}

/**
 * App-wide motion settings:
 * - reducedMotion="user": every framer-motion animation honours the OS
 *   "reduce motion" setting (plus the global skip above).
 * - LazyMotion + domAnimation: `m.*` components load only the DOM animation
 *   feature set (~15 KB gz) instead of the full bundle. Components should
 *   migrate from `motion.*` to `m.*`; `motion.*` still works meanwhile.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
    return (
        <LazyMotion features={domAnimation}>
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </LazyMotion>
    );
}

export default MotionProvider;
