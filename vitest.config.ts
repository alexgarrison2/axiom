import path from 'node:path';
import { defineConfig } from 'vitest/config';

/*
 * Unit tests for pure TS/TSX logic. Put tests next to the code
 * (lib/matchup/pills.test.ts) or under tests/unit/. The default environment is
 * node; a component test that needs a DOM opts in with a first-line comment:
 *   // @vitest-environment jsdom
 * Playwright specs live in tests/e2e and are excluded here.
 */
export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(__dirname) },
    },
    oxc: {
        jsx: { runtime: 'automatic' },
    },
    test: {
        environment: 'node',
        include: ['**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**', '.next/**', 'tests/e2e/**', '.claude/**'],
        restoreMocks: true,
    },
});
