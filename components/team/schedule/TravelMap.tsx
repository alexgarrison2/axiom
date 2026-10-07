'use client';

import * as React from 'react';
import { ARENAS } from '@/lib/schedule/arenas';
import type { Leg, SchedGame, TeamSchedule } from '@/lib/schedule/metrics';
import { applyFit, arcPath, fitBox, toBase, type Fit, type LonLat, type Tilt } from '@/lib/schedule/projection';
import { Segmented } from '@/components/ui/segmented';
import { inFocus, reducedMotion, type Focus } from './schedule-ui';
import { useSize } from './use-width';

export interface NaGeo {
    land: number[][];
    admin1: number[][];
    lakes: number[][];
}

interface TravelMapProps {
    tri: string;
    schedule: TeamSchedule;
    geo: NaGeo | null;
    focus: Focus;
    teamColor: string;
    selectedId: number | null;
    onSelect: (id: number) => void;
    /** Summary line drawn over the map's top-left corner. */
    caption?: React.ReactNode;
}

/** Off-map stand-in for venues abroad (Global Series): south of Newfoundland, the way out. */
const PORTAL: LonLat = [-55.5, 45.2];
const FRAME: LonLat[] = [];
for (const lon of [-125, -110, -96, -82, -67]) for (const lat of [25, 40, 52]) FRAME.push([lon, lat]);

const PITCH_3D = 40;
const DISTANCE = 2.3;

function decode(arr: number[]): LonLat[] {
    const out: LonLat[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i + 1 < arr.length; i += 2) {
        x = i === 0 ? arr[0] : x + arr[i];
        y = i === 0 ? arr[1] : y + arr[i + 1];
        out.push([x / 100, y / 100]);
    }
    return out;
}

const isAbroad = (p: { lon: number }) => p.lon > -50;
const ll = (p: { lat: number; lon: number }): LonLat => (isAbroad(p) ? PORTAL : [p.lon, p.lat]);

function pathOf(pts: [number, number][], close = false): string {
    if (pts.length < 2) return '';
    let d = `M${pts[0][0].toFixed(4)},${pts[0][1].toFixed(4)}`;
    for (let i = 1; i < pts.length; i++) d += `L${pts[i][0].toFixed(4)},${pts[i][1].toFixed(4)}`;
    return close ? `${d}Z` : d;
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * The season's travel on a tilted, dark North America: Albers conic laid on
 * a table with perspective, flights as great-circle arcs that lift with
 * distance (a ground track underneath). The whole route sits in the team's
 * colour; the focused month or trip draws in brighter and the camera eases to
 * it; the picked game's flight is cyan. Crests stand on the venues of the
 * focus like pins. A FLAT toggle lays the table down.
 */
export function TravelMap({ tri, schedule, geo, focus, teamColor, selectedId, onSelect, caption }: TravelMapProps) {
    const [ref, size] = useSize<HTMLDivElement>();
    const width = size.w;
    const W = Math.max(280, width);
    const H = Math.round(Math.min(600, Math.max(250, W * (W < 640 ? 0.78 : 0.72))));
    const [mode, setMode] = React.useState<'3d' | 'flat'>('3d');

    // Animated camera: pitch and fit ease together.
    const [pitch, setPitch] = React.useState(PITCH_3D);
    const tiltOf = React.useCallback((p: number): Tilt => ({ pitch: p, distance: DISTANCE }), []);
    const tilt = tiltOf(pitch);

    const home = ARENAS[tri];
    const focusGames = React.useMemo(() => schedule.games.filter(g => inFocus(g, focus)), [schedule.games, focus]);
    const focusIdx = React.useMemo(() => new Set(focusGames.map(g => g.n - 1)), [focusGames]);
    const legIn = React.useCallback(
        (l: Leg) => {
            if (focus.kind === 'season') return true;
            if (focus.kind === 'trip') return l.trip === focus.id;
            return l.toGame != null ? focusIdx.has(l.toGame) : l.fromGame != null && focusIdx.has(l.fromGame);
        },
        [focus, focusIdx],
    );
    const focusLegs = React.useMemo(() => schedule.legs.filter(legIn), [schedule.legs, legIn]);

    // Venues in focus (road + special), keyed by place.
    const venues = React.useMemo(() => {
        const m = new Map<string, { lat: number; lon: number; city: string; games: SchedGame[]; crest: string }>();
        for (const l of focusLegs) {
            if (l.toGame == null) continue;
            const g = schedule.games[l.toGame];
            const cur = m.get(l.to.key) ?? { lat: l.to.lat, lon: l.to.lon, city: l.to.city, games: [], crest: g.home ? tri : g.opp };
            cur.games.push(g);
            m.set(l.to.key, cur);
        }
        for (const g of focusGames) {
            if (!m.has(g.place) && g.place !== tri) {
                const leg = schedule.legs.find(l => l.toGame === g.n - 1);
                if (leg) m.set(g.place, { lat: leg.to.lat, lon: leg.to.lon, city: leg.to.city, games: [g], crest: g.home ? tri : g.opp });
            }
        }
        return m;
    }, [focusLegs, focusGames, schedule.games, schedule.legs, tri]);

    const targetFit = React.useCallback(
        (p: number): Fit => {
            const t = tiltOf(p);
            const pad = { x: 18, top: 44, bottom: 18 };
            const frame = FRAME.map(q => toBase(q, 0, t));
            const fx = frame.map(q => q[0]);
            const minSpan = (Math.max(...fx) - Math.min(...fx)) * 0.34;
            if (focus.kind === 'season' || venues.size === 0) {
                const pts = [...frame, ...Object.values(ARENAS).map(a => toBase([a.lon, a.lat], 0, t))];
                return fitBox(pts, W, H, pad);
            }
            const pts: [number, number][] = [toBase([home.lon, home.lat], 0, t)];
            for (const v of venues.values()) pts.push(toBase(ll(v), 0, t));
            return fitBox(pts, W, H, { x: 40, top: 70, bottom: 30 }, minSpan);
        },
        [focus.kind, venues, W, H, home, tiltOf],
    );

    const [fit, setFit] = React.useState<Fit>(() => ({ k: 1, tx: 0, ty: 0 }));
    // The camera as last drawn, so a new move starts from where the previous one is.
    const camRef = React.useRef<{ pitch: number; fit: Fit } | null>(null);
    const setCam = React.useCallback((p: number, f: Fit) => {
        camRef.current = { pitch: p, fit: f };
        setPitch(p);
        setFit(f);
    }, []);

    React.useEffect(() => {
        if (!width) return;
        const toPitch = mode === '3d' ? PITCH_3D : 0;
        const cam = camRef.current;
        if (!cam || reducedMotion()) {
            setCam(toPitch, targetFit(toPitch));
            return;
        }
        const from = cam.fit;
        const fromPitch = cam.pitch;
        const t0 = performance.now();
        const dur = 650;
        let raf = 0;
        const step = (now: number) => {
            const e = easeOutExpo(Math.min(1, (now - t0) / dur));
            const p = fromPitch + (toPitch - fromPitch) * e;
            // Ease toward the target at the current pitch; zoom in log scale so it feels even.
            const pf = targetFit(p);
            const k = Math.exp(Math.log(from.k) + (Math.log(pf.k) - Math.log(from.k)) * e);
            setCam(p, { k, tx: from.tx + (pf.tx - from.tx) * e, ty: from.ty + (pf.ty - from.ty) * e });
            if (e < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [mode, targetFit, width, setCam]);

    // Base geometry (depends on pitch only).
    const base = React.useMemo(() => {
        if (!geo) return null;
        const proj = (pts: LonLat[]) => pts.map(p => toBase(p, 0, tilt));
        const grat: string[] = [];
        for (let lat = 25; lat <= 65; lat += 5) {
            const pts: LonLat[] = [];
            for (let lon = -140; lon <= -45; lon += 2.5) pts.push([lon, lat]);
            grat.push(pathOf(proj(pts)));
        }
        for (let lon = -140; lon <= -50; lon += 10) {
            const pts: LonLat[] = [];
            for (let lat = 18; lat <= 66; lat += 2) pts.push([lon, lat]);
            grat.push(pathOf(proj(pts)));
        }
        return {
            land: geo.land.map(r => pathOf(proj(decode(r)), true)).join(''),
            lakes: geo.lakes.map(r => pathOf(proj(decode(r)), true)).join(''),
            admin1: geo.admin1.map(r => pathOf(proj(decode(r)))).join(''),
            grat: grat.join(''),
        };
    }, [geo, tilt]);

    const arcs = React.useMemo(
        () =>
            schedule.legs.map(l => {
                const a = ll(l.from);
                const b = ll(l.to);
                return {
                    leg: l,
                    air: pathOf(arcPath(a, b, tilt, 0.2)),
                    ground: pathOf(arcPath(a, b, tilt, 0)),
                    abroad: isAbroad(l.from) || isAbroad(l.to),
                };
            }),
        [schedule.legs, tilt],
    );

    const selIdx = selectedId != null ? schedule.games.findIndex(g => g.id === selectedId) : -1;
    const focusKey = focus.kind === 'season' ? 'season' : focus.kind === 'month' ? focus.key : focus.kind === 'trip' ? `trip-${focus.id}` : `r-${focus.first}`;
    const P = (p: LonLat, h = 0) => applyFit(toBase(p, h, tilt), fit);
    const k = fit.k;
    const matrix = `matrix(${k} 0 0 ${k} ${fit.tx} ${fit.ty})`;
    const homeXY = P([home.lon, home.lat]);
    const crestSize = W < 640 ? 20 : 26;
    const showCrests = focus.kind !== 'season' && venues.size <= 14;
    const abroadVenues = [...venues.entries()].filter(([, v]) => isAbroad(v));

    return (
        <div ref={ref} className="relative w-full overflow-hidden rounded-card" style={{ height: H }}>
            {width > 0 && base ? (
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Travel map of the season's flights" className="block touch-pan-y">
                    <defs>
                        <linearGradient id="sched-fog" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="var(--panel-top)" stopOpacity="1" />
                            <stop offset="0.28" stopColor="var(--panel-top)" stopOpacity="0" />
                        </linearGradient>
                        <radialGradient id="sched-crest-shadow">
                            <stop offset="0" stopColor="#000" stopOpacity="0.55" />
                            <stop offset="1" stopColor="#000" stopOpacity="0" />
                        </radialGradient>
                        <style>{`@keyframes sched-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}.sched-draw{stroke-dasharray:1;animation:sched-draw .9s cubic-bezier(.16,1,.3,1) both}@media (prefers-reduced-motion:reduce){.sched-draw{animation:none}}`}</style>
                    </defs>
                    <g transform={matrix}>
                        <path d={base.grat} fill="none" stroke="rgb(var(--line-rgb))" strokeOpacity={0.7} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                        <path d={base.land} fill="rgb(var(--surface-3-rgb))" fillOpacity={0.95} stroke="rgb(var(--brand-rgb))" strokeOpacity={0.42} strokeWidth={0.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                        <path d={base.admin1} fill="none" stroke="rgb(var(--brand-rgb))" strokeOpacity={0.14} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                        <path d={base.lakes} fill="var(--panel-bottom)" stroke="rgb(var(--brand-rgb))" strokeOpacity={0.2} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />

                        {/* the whole season, quiet */}
                        {arcs.map((a, i) =>
                            legIn(a.leg) && focus.kind !== 'season' ? null : (
                                <path
                                    key={`all-${i}`}
                                    d={a.air}
                                    fill="none"
                                    stroke={teamColor}
                                    strokeOpacity={focus.kind === 'season' ? 0.42 : 0.14}
                                    strokeWidth={focus.kind === 'season' ? 1.1 : 0.9}
                                    strokeDasharray={a.abroad ? '3 3' : undefined}
                                    vectorEffect="non-scaling-stroke"
                                />
                            ),
                        )}

                        {/* focus: ground track, then the flight drawing in */}
                        {focus.kind !== 'season' ? (
                            <g key={focusKey}>
                                {arcs
                                    .filter(a => legIn(a.leg))
                                    .map((a, i) => (
                                        <path key={`gr-${i}`} d={a.ground} fill="none" stroke="#000" strokeOpacity={0.32} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                                    ))}
                                {arcs
                                    .filter(a => legIn(a.leg))
                                    .map((a, i) => (
                                        <path
                                            key={`fx-${i}`}
                                            d={a.air}
                                            pathLength={a.abroad ? undefined : 1}
                                            className={a.abroad ? undefined : 'sched-draw'}
                                            style={a.abroad ? undefined : { animationDelay: `${Math.min(i, 12) * 45}ms` }}
                                            fill="none"
                                            stroke={teamColor}
                                            strokeOpacity={0.95}
                                            strokeWidth={2}
                                            strokeDasharray={a.abroad ? '4 3' : undefined}
                                            strokeLinecap="round"
                                            vectorEffect="non-scaling-stroke"
                                        />
                                    ))}
                            </g>
                        ) : null}

                        {/* the picked game's flight */}
                        {arcs
                            .filter(a => selIdx >= 0 && a.leg.toGame === selIdx)
                            .map((a, i) => (
                                <path key={`sel-${i}`} d={a.air} fill="none" stroke="rgb(var(--brand-rgb))" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={a.abroad ? '4 3' : undefined} vectorEffect="non-scaling-stroke" />
                            ))}
                    </g>
                    <rect x={0} y={0} width={W} height={H} fill="url(#sched-fog)" pointerEvents="none" />

                    {/* league arenas */}
                    {Object.entries(ARENAS).map(([t, a]) => {
                        const [x, y] = P([a.lon, a.lat]);
                        return <circle key={t} cx={x} cy={y} r={1.8} fill="rgb(var(--text-3-rgb))" fillOpacity={0.55} />;
                    })}

                    {/* focus venues: pins with crests */}
                    {[...venues.entries()].map(([key, v]) => {
                        const [x, y] = P(ll(v));
                        const picked = v.games.some(g => g.id === selectedId);
                        const stem = showCrests ? 12 : 0;
                        const go = () => {
                            const next = v.games.find(g => g.state !== 'final') ?? v.games[0];
                            if (next) onSelect(next.id);
                        };
                        return (
                            <g key={key} className="cursor-pointer" onClick={go}>
                                <title>{`${v.city}: ${v.games.length} game${v.games.length > 1 ? 's' : ''}`}</title>
                                <circle cx={x} cy={y} r={16} fill="transparent" />
                                <ellipse cx={x} cy={y} rx={3.6} ry={2.2} fill="#000" fillOpacity={0.6} />
                                {stem ? <line x1={x} x2={x} y1={y} y2={y - stem} stroke="rgb(var(--text-2-rgb))" strokeOpacity={0.7} strokeWidth={1} /> : null}
                                <circle cx={x} cy={y} r={3} fill="rgb(var(--text-1-rgb))" />
                                {picked ? <circle cx={x} cy={y} r={7} fill="none" stroke="rgb(var(--brand-rgb))" strokeWidth={1.75} /> : null}
                                {showCrests ? (
                                    <>
                                        {/* A painted soft shadow, not a CSS filter: Safari draws filtered SVG images as black tiles while the map moves. */}
                                        <ellipse cx={x} cy={y - stem - crestSize * 0.12} rx={crestSize * 0.55} ry={crestSize * 0.5} fill="url(#sched-crest-shadow)" />
                                        <image href={`/logos/${v.crest}.svg`} x={x - crestSize / 2} y={y - stem - crestSize} width={crestSize} height={crestSize} />
                                    </>
                                ) : null}
                            </g>
                        );
                    })}

                    {/* venues abroad sit at the map's edge */}
                    {abroadVenues.map(([key, v]) => {
                        const [x, y] = P(PORTAL);
                        const right = x > W - 90;
                        return (
                            <text key={`ab-${key}`} x={right ? x - 10 : x + 10} y={y + (showCrests ? 16 : 4)} textAnchor={right ? 'end' : 'start'} className="text-micro font-medium uppercase" fill="rgb(var(--warn-rgb))" style={{ letterSpacing: '0.12em', paintOrder: 'stroke', stroke: 'var(--panel-bottom)', strokeWidth: 3 }}>
                                {v.city} →
                            </text>
                        );
                    })}

                    {/* home */}
                    <g>
                        <circle cx={homeXY[0]} cy={homeXY[1]} r={9} fill={teamColor} fillOpacity={0.18} />
                        <circle cx={homeXY[0]} cy={homeXY[1]} r={4.5} fill={teamColor} stroke="var(--panel-bottom)" strokeWidth={1.5} />
                    </g>
                </svg>
            ) : (
                <div className="h-full w-full animate-pulse bg-surface-1" role="status" aria-label="Loading the map" />
            )}
            {caption ? <div className="pointer-events-none absolute left-3 top-2.5 text-micro font-medium uppercase tracking-label text-fg-2 md:left-4 md:top-3">{caption}</div> : null}
            <div className="absolute right-2 top-2 md:right-3 md:top-2.5">
                <Segmented
                    label="Map view"
                    size="sm"
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: '3d', label: '3D' },
                        { value: 'flat', label: 'Flat' },
                    ]}
                />
            </div>
        </div>
    );
}

export default TravelMap;
