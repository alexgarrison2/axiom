import { redirect } from 'next/navigation';
import { listArchiveSeasons } from '@/components/playoff/archive';
import { playoffsActive } from '@/components/SiteNav';
import { SEASON_ID } from '@/lib/season';

// /playoffs is a pointer, not a page: the current postseason while it runs
// (pipeline/build_playoff_archive.py --season <current> keeps its summary
// fresh), otherwise the most recent archive.
export const revalidate = 3600;

export default function PlayoffsIndex() {
    const seasons = listArchiveSeasons();
    const target = playoffsActive() && seasons.includes(SEASON_ID) ? SEASON_ID : seasons[0];
    redirect(target ? `/playoffs/${target}` : '/standings');
}
