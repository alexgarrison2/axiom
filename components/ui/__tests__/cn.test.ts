import { describe, expect, it } from 'vitest';
import { cn } from '../../../lib/utils';

describe('cn() knows the design tokens', () => {
    it('keeps a type token and a colour token together', () => {
        expect(cn('text-caption', 'text-fg-2')).toBe('text-caption text-fg-2');
        expect(cn('text-micro text-brand', 'text-pos')).toBe('text-micro text-pos');
    });

    it('lets the last type / radius token win', () => {
        expect(cn('text-caption', 'text-body')).toBe('text-body');
        expect(cn('rounded-chip', 'rounded-card')).toBe('rounded-card');
    });
});
