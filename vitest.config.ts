import { defineConfig } from 'vitest/config';

// Unit tests only. Playwright specs in tests/ run with `npm run test:e2e`.
export default defineConfig({
    test: {
        include: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
        exclude: ['node_modules/**', '.next/**', '.claude/**', 'tests/**'],
        environment: 'node',
    },
});
