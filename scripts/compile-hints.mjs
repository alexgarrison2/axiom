#!/usr/bin/env node
/*
 * Post-build: mark the framework chunks for eager compilation (V8 explicit
 * compile hints, https://v8.dev/blog/explicit-compile-hints).
 *
 *   next build && node scripts/compile-hints.mjs
 *
 * Every page loads the same root chunks (React DOM, the Next client runtime,
 * the Turbopack runtime: build-manifest.json `rootMainFiles`). Turbopack wraps
 * each module in a function, and V8 compiles a function lazily, on the main
 * thread, the first time it runs. On a cold load the whole framework runs at
 * once during bootstrap, so that compile landed in one long task: about two
 * thirds of the biggest task on every page under the CI's throttled phone
 * profile. With `//# allFunctionsCalledOnLoad` as the first line, Chrome
 * compiles these scripts' functions while streaming them, off the main thread.
 * Only the root chunks are marked: nearly all of their code runs on every
 * load, which is the case the hint is for. Browsers without the hint read a
 * plain comment.
 *
 * Idempotent; exits 1 when the build manifest or a listed chunk is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HINT = '//# allFunctionsCalledOnLoad\n';

/** The chunk text with the hint as its first line (unchanged when already hinted). */
export function withHint(src) {
    return src.startsWith(HINT) ? src : HINT + src;
}

function main() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const next = path.join(root, '.next');
    const manifest = path.join(next, 'build-manifest.json');
    if (!fs.existsSync(manifest)) {
        console.error('compile-hints: no .next/build-manifest.json. Run `next build` first.');
        process.exit(1);
    }
    const files = (JSON.parse(fs.readFileSync(manifest, 'utf8')).rootMainFiles ?? []).filter(f => f.endsWith('.js'));
    if (!files.length) {
        console.error('compile-hints: build-manifest.json lists no rootMainFiles.');
        process.exit(1);
    }
    for (const rel of files) {
        const file = path.join(next, rel);
        if (!fs.existsSync(file)) {
            console.error(`compile-hints: ${rel} is listed but missing.`);
            process.exit(1);
        }
        const src = fs.readFileSync(file, 'utf8');
        const out = withHint(src);
        if (out !== src) fs.writeFileSync(file, out);
        console.log(`compile-hints: ${out === src ? 'already hinted' : 'hinted'} ${rel} (${(src.length / 1024).toFixed(0)}KB)`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
