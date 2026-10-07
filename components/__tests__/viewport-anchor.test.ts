import { describe, expect, it } from 'vitest';
import { trustedShift, viewportShift, type ViewportSample } from '../ViewportAnchor';

describe('viewportShift', () => {
    it('is zero when fixed elements and the visual viewport agree', () => {
        expect(viewportShift({ top: 0, bottom: 852 }, { top: 0, bottom: 852 })).toEqual({ top: 0, bottom: 0 });
        // Sub-pixel noise during toolbar transitions does not move anything.
        expect(viewportShift({ top: 0, bottom: 852 }, { top: 0.4, bottom: 852.6 })).toEqual({ top: 0, bottom: 0 });
    });

    it('moves the pinned bars back on screen when iOS leaves the visual viewport offset', () => {
        // iOS 26 after the keyboard closes: visual viewport stuck 269px below the layout viewport.
        expect(viewportShift({ top: 0, bottom: 852 }, { top: 269, bottom: 1121 })).toEqual({ top: 269, bottom: 269 });
        // Layout viewport left short (bar floating at 583 on an 852pt screen).
        expect(viewportShift({ top: 0, bottom: 583 }, { top: 0, bottom: 852 })).toEqual({ top: 0, bottom: 269 });
    });
});

describe('trustedShift', () => {
    // Values below were measured in iOS 26.5 Safari (iPhone 17 Pro simulator) on /games/2026020048.
    const sample = (over: Partial<ViewportSample>): ViewportSample => ({
        fixed: { top: 0, bottom: 714 },
        visual: { top: 0, bottom: 714 },
        scrollY: 0,
        maxScroll: 9996,
        scale: 1,
        editing: false,
        ...over,
    });

    it('is zero during ordinary browsing', () => {
        expect(trustedShift(sample({}))).toEqual({ top: 0, bottom: 0 });
        expect(trustedShift(sample({ scrollY: 3693, fixed: { top: 0, bottom: 754 }, visual: { top: 0, bottom: 754 } }))).toEqual({ top: 0, bottom: 0 });
    });

    it('ignores rubber-band overscroll at the top (visual viewport shrinks by the pull)', () => {
        // The old anchor lifted the tab bar 162px into the middle of the screen here.
        expect(trustedShift(sample({ visual: { top: 0, bottom: 552 } }))).toBeNull();
        expect(trustedShift(sample({ scrollY: -40 }))).toBeNull();
    });

    it('ignores rubber-band overscroll at the bottom (scrolled past the end)', () => {
        // The old anchor pushed the app bar 508px down the screen here.
        expect(trustedShift(sample({ scrollY: 10246, maxScroll: 9992, fixed: { top: -254, bottom: 463.7 }, visual: { top: 254, bottom: 972 } }))).toBeNull();
    });

    it('ignores the keyboard height that lingers right after the keyboard closes', () => {
        expect(trustedShift(sample({ scrollY: 226, maxScroll: 1505, fixed: { top: 0, bottom: 754 }, visual: { top: 0, bottom: 377 } }))).toBeNull();
    });

    it('leaves native behaviour alone while editing or pinch-zoomed', () => {
        expect(trustedShift(sample({ editing: true, visual: { top: 269, bottom: 983 } }))).toBeNull();
        expect(trustedShift(sample({ scale: 2, visual: { top: 120, bottom: 477 } }))).toBeNull();
    });

    it('still reports the stranded visual viewport of WebKit bug 297779', () => {
        expect(trustedShift(sample({ scrollY: 1200, visual: { top: 269, bottom: 983 } }))).toEqual({ top: 269, bottom: 269 });
        expect(trustedShift(sample({ scrollY: 1200, fixed: { top: 0, bottom: 445 }, visual: { top: 0, bottom: 714 } }))).toEqual({ top: 0, bottom: 269 });
    });

    it('treats a page shorter than the viewport as in range', () => {
        expect(trustedShift(sample({ maxScroll: -20 }))).toEqual({ top: 0, bottom: 0 });
    });
});
