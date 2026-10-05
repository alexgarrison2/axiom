import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import GameView from '@/components/game/GameView';
import { getGame, validGameId } from '@/lib/game/fetch';

// The NHL feeds are cached per request type in lib/game/fetch (30s live, a day final).
export const revalidate = 30;

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { id } = await params;
    if (!validGameId(id)) return { title: 'Game' };
    const m = await getGame(id);
    if (!m) return { title: 'Game' };
    const { away, home } = m.teams;
    const score = m.state === 'pre' ? '' : ` ${away.score}–${home.score}`;
    return {
        title: `${away.tri} @ ${home.tri}${score} · ${m.date}`,
        description: `${away.place} ${away.name} at ${home.place} ${home.name}, ${m.date}: goals, pony xG, shot map, skaters, lines, matchups and zone starts.`,
        alternates: { canonical: `/games/${id}` },
    };
}

export default async function GamePage({ params }: Params) {
    const { id } = await params;
    const m = await getGame(id);
    if (!m) notFound();
    return (
        <main className="page pb-tabbar pt-3 md:pb-12 md:pt-5">
            <GameView m={m} />
        </main>
    );
}
