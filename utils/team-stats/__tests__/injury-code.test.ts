import { describe, expect, it } from 'vitest';
import { injuryCode } from '../format';

describe('injuryCode', () => {
    it('maps injury statuses to short codes', () => {
        expect(injuryCode('Injured Reserve')).toBe('IR');
        expect(injuryCode('Long-Term Injured Reserve')).toBe('LTIR');
        expect(injuryCode('Day-To-Day')).toBe('DTD');
        expect(injuryCode('Suspension')).toBe('SUSP');
        expect(injuryCode('Out')).toBe('OUT');
    });
});
