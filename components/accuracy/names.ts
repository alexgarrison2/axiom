import { TEAM_NAMES } from '@/components/ui/team-color';

const NAME_TO_TRI: Record<string, string> = {
    ...Object.fromEntries(Object.entries(TEAM_NAMES).flatMap(([tri, n]) => [[n.short, tri], [n.name, tri]])),
    'Utah Hockey Club': 'UTA',
    'Montreal Canadiens': 'MTL',
};

/** "Golden Knights" / "Vegas Golden Knights" / "VGK" → "VGK" (null for non-NHL names). */
export function teamTriFromName(name: string | null | undefined): string | null {
    if (!name) return null;
    const t = name.trim();
    return NAME_TO_TRI[t] ?? (TEAM_NAMES[t] ? t : null);
}
