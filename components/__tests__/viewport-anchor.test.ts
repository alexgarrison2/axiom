import { describe, expect, it } from 'vitest';
import { viewportShift } from '../ViewportAnchor';

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
