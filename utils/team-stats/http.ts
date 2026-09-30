import { NextResponse } from 'next/server';

/** Data changes only on redeploy (every pipeline run), so the CDN can hold it. */
export const TEAM_DATA_CACHE = 'public, s-maxage=600, stale-while-revalidate=86400';

export function jsonResponse(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': status === 200 ? TEAM_DATA_CACHE : 'no-store' },
    });
}
