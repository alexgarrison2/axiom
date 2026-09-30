import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, GLOSSARY_ANCHORS, GLOSSARY_TERMS, isGlossaryTerm } from '../../../lib/glossary';

const ROOT = resolve(__dirname, '../../..');

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.') || name === '__tests__') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(tsx|ts)$/.test(name)) out.push(p);
    }
    return out;
}

/** Every term="…" passed to <InfoTip> in app/ and components/. */
function infoTipTerms(): { term: string; file: string }[] {
    const found: { term: string; file: string }[] = [];
    const re = /<InfoTip\b[^>]*?\bterm=(?:"([^"]+)"|'([^']+)'|\{\s*["'`]([^"'`]+)["'`]\s*\})/g;
    for (const file of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(re)) found.push({ term: m[1] ?? m[2] ?? m[3], file: file.slice(ROOT.length + 1) });
    }
    return found;
}

/** Every glossary id linked from code: <GlossLink term="…">, glossaryHref('…') and termHref-style "#term-…" strings. */
function linkedTermIds(): { id: string; file: string }[] {
    const found: { id: string; file: string }[] = [];
    const res = [/<GlossLink\b[^>]*?\bterm="([^"]+)"/g, /glossaryHref\(\s*'([^']+)'\s*\)/g, /\/methodology#term-([a-z0-9-]+)/g];
    for (const file of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'lib'))]) {
        const src = readFileSync(file, 'utf8');
        for (const re of res) for (const m of src.matchAll(re)) found.push({ id: m[1], file: file.slice(ROOT.length + 1) });
    }
    return found;
}

describe('glossary', () => {
    it('every linked #term-… anchor is rendered on /methodology', () => {
        const missing = linkedTermIds().filter(t => !GLOSSARY_ANCHORS.includes(`term-${t.id}`));
        expect(missing).toEqual([]);
    });

    it('every InfoTip term exists in lib/glossary.ts', () => {
        const missing = infoTipTerms().filter(t => !isGlossaryTerm(t.term));
        expect(missing).toEqual([]);
    });

    it('covers the terms the site explains', () => {
        for (const t of ['model-pct', 'market-pct', 'fair-odds', 'edge', 'units', 'projected-goals', 'gsax', 'pp-pk', 'last-n', 'h2h', 'confidence', 'rest', 'result-codes']) {
            expect(GLOSSARY_TERMS).toContain(t);
        }
    });

    it('every entry has a label, title and a short plain-language definition', () => {
        for (const key of GLOSSARY_TERMS) {
            const e = GLOSSARY[key];
            expect(e.label.length, key).toBeGreaterThan(0);
            expect(e.title.length, key).toBeGreaterThan(0);
            expect(e.short.length, key).toBeGreaterThan(20);
            expect(e.short.length, key).toBeLessThan(260);
        }
    });

    it('anchors point at sections that exist on /methodology', () => {
        const page = readFileSync(join(ROOT, 'app/methodology/page.tsx'), 'utf8');
        for (const key of GLOSSARY_TERMS) {
            const anchor = (GLOSSARY[key] as { anchor?: string }).anchor;
            if (anchor) expect(page.includes(`id: '${anchor}'`) || page.includes(`id="${anchor}"`), `${key} → #${anchor}`).toBe(true);
        }
    });
});
