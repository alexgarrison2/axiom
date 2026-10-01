'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Favourite teams (tricodes), kept in localStorage. Every storage access is
 * wrapped: private windows, blocked site data or a throwing accessor just
 * mean "no favourites" and the page renders normally.
 */
const KEY = 'ponyxg:favorites';
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cached: string[] | null = null;

function read(): string[] {
    if (cached) return cached;
    try {
        const raw = window.localStorage.getItem(KEY);
        const v = raw ? (JSON.parse(raw) as unknown) : [];
        const list = Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && /^[A-Z]{3}$/.test(t)).slice(0, 8) : [];
        // No favourites: the same EMPTY the server snapshot returns, so hydration
        // does not schedule a blocking re-render of the whole slate for an equal [].
        cached = list.length ? list : EMPTY;
    } catch {
        cached = EMPTY;
    }
    return cached;
}

function write(next: string[]) {
    cached = next;
    try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
        /* storage unavailable: keep the in-memory value for this visit */
    }
    listeners.forEach(l => l());
}

function subscribe(l: () => void) {
    listeners.add(l);
    const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
            cached = null;
            l();
        }
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(l);
        window.removeEventListener('storage', onStorage);
    };
}

export function useFavorites() {
    const favorites = useSyncExternalStore(subscribe, read, () => EMPTY);
    const toggle = useCallback((tri: string) => {
        const cur = read();
        write(cur.includes(tri) ? cur.filter(t => t !== tri) : [...cur, tri]);
    }, []);
    const isFavorite = useCallback((tri: string) => favorites.includes(tri), [favorites]);
    return { favorites, toggle, isFavorite };
}

export default useFavorites;
