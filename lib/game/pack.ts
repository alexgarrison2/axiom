import type { GameModel } from './types';

const packs = new Map<number, Promise<GameModel | null>>();

/** One game's model in the browser (/api/game-pack/[id], cached at the edge), fetched once per page; null when it cannot be had. */
export function gamePack(id: number): Promise<GameModel | null> {
    if (!packs.has(id)) {
        packs.set(
            id,
            fetch(`/api/game-pack/${id}`)
                .then(r => (r.ok ? (r.json() as Promise<GameModel>) : null))
                .catch(() => null),
        );
    }
    return packs.get(id)!;
}
