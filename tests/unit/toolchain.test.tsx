// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

/*
 * Guards the unit-test toolchain other workstreams build on: TSX with the
 * automatic JSX runtime, the '@/' alias, jsdom + Testing Library, and
 * server rendering to a string.
 */
function Chip({ label, active }: { label: string; active?: boolean }) {
    return <span className={cn('chip', active && 'chip--active')}>{label}</span>;
}

describe('unit test toolchain', () => {
    it('renders TSX in jsdom with Testing Library', () => {
        render(<Chip label="Season opener" active />);
        expect(screen.getByText('Season opener').className).toBe('chip chip--active');
    });

    it('server-renders components to static markup', () => {
        expect(renderToStaticMarkup(<Chip label="L3" />)).toBe('<span class="chip">L3</span>');
    });
});
