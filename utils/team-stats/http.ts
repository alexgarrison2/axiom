import { NextResponse } from 'next/server';
import { dataCacheHeaders } from '@/lib/http-cache';

/** Data changes only on redeploy (every pipeline run), so the CDN can hold it; the browser always asks. */
const TEAM_DATA_CACHE = dataCacheHeaders(0, 600);

export function jsonResponse(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: status === 200 ? TEAM_DATA_CACHE : { 'Cache-Control': 'no-store' },
    });
}
