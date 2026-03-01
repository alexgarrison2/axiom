"use client";

import React, { useMemo, useState } from 'react';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import { getTeamColor } from '@/utils/team-colors';
import PlayoffDetailModal from './PlayoffDetailModal';

// ─────────────────────────────────────────────────────────────────────────────
// Vivid color overrides for dark-background legibility
// ─────────────────────────────────────────────────────────────────────────────

const VIVID: Record<string, string> = {
  EDM: '#FF4C00', WPG: '#4f8de8', TOR: '#4f8de8', TBL: '#3278d4',
  VAN: '#00843D', LAK: '#A8AEB5', SEA: '#7de0de', STL: '#4f8de8',
  BUF: '#FCB514', PIT: '#FCB514', CBJ: '#CE1126', WSH: '#C8102E',
  NJD: '#CE1126', DET: '#CE1126', MIN: '#3a8f5a', COL: '#8C3A56',
};
function tc(code: string) { return VIVID[code] ?? getTeamColor(code); }

// ─────────────────────────────────────────────────────────────────────────────
// WaffleGrid — tight SVG grid of colored squares
// ─────────────────────────────────────────────────────────────────────────────

interface WafSeg { color: string; count: number }

const WaffleGrid: React.FC<{
  segs: WafSeg[];
  cols: number; rows: number;
  cs?: number; gap?: number; rx?: number;
  empty?: string;
}> = ({ segs, cols, rows, cs = 6, gap = 1, rx = 1.5, empty = '#111420' }) => {
  const total = cols * rows;
  const step  = cs + gap;
  const cells: string[] = [];
  for (const s of segs) for (let i = 0; i < s.count && cells.length < total; i++) cells.push(s.color);
  while (cells.length < total) cells.push(empty);
  return (
    <svg width={cols * step - gap} height={rows * step - gap} style={{ display: 'block' }}>
      {cells.map((c, i) => (
        <rect key={i} x={(i % cols) * step} y={Math.floor(i / cols) * step}
          width={cs} height={cs} fill={c} rx={rx} />
      ))}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Probability math
// ─────────────────────────────────────────────────────────────────────────────

function fac(n: number): number { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function choose(n: number, k: number) { return fac(n) / (fac(k) * fac(n - k)); }
function poisson(k: number, l: number) { return (l ** k * Math.exp(-l)) / fac(k); }

function winProb(home: TeamStandings, away: TeamStandings) {
  const AVG = 2.35, HI = 0.16, ST = 0.18;
  const h5  = (home.xgf_5v5 * away.xga_5v5) / AVG;
  const a5  = (away.xgf_5v5 * home.xga_5v5) / AVG;
  const hO  = (home.pen_drawn_60 + away.pen_taken_60) / 2;
  const aO  = (away.pen_drawn_60 + home.pen_taken_60) / 2;
  const hX  = Math.max(0.1, h5 + HI + hO * ST * home.pp_eff * away.pk_eff - away.goalie_rating * 0.5);
  const aX  = Math.max(0.1, a5 + aO * ST * away.pp_eff * home.pk_eff - home.goalie_rating * 0.5);
  let w = 0, l = 0, t = 0;
  for (let h = 0; h < 12; h++) for (let a = 0; a < 12; a++) {
    const p = poisson(h, hX) * poisson(a, aX);
    if (h > a) w += p; else if (a > h) l += p; else t += p;
  }
  const tot = w + l + t;
  return (w / tot) + (t / tot) * (hX / (hX + aX));
}

interface SeriesBreak { hw: number; lw: number; bars: { g: number; h: number; l: number }[] }
function seriesBreak(p: number): SeriesBreak {
  let hw = 0, lw = 0;
  const bars = [4, 5, 6, 7].map(g => {
    const ways = choose(g - 1, 3);
    const ph = ways * p ** 4 * (1 - p) ** (g - 4);
    const pl = ways * (1 - p) ** 4 * p ** (g - 4);
    hw += ph; lw += pl;
    return { g, h: ph * 100, l: pl * 100 };
  });
  return { hw: hw * 100, lw: lw * 100, bars };
}

// ─────────────────────────────────────────────────────────────────────────────
// Division / Conference maps & seeding
// ─────────────────────────────────────────────────────────────────────────────

const DIV: Record<string, string> = {
  BOS:'ATL', BUF:'ATL', DET:'ATL', FLA:'ATL', MTL:'ATL', OTT:'ATL', TBL:'ATL', TOR:'ATL',
  CAR:'MET', CBJ:'MET', NJD:'MET', NYI:'MET', NYR:'MET', PHI:'MET', PIT:'MET', WSH:'MET',
  CHI:'CEN', COL:'CEN', DAL:'CEN', MIN:'CEN', NSH:'CEN', STL:'CEN', UTA:'CEN', WPG:'CEN',
  ANA:'PAC', CGY:'PAC', EDM:'PAC', LAK:'PAC', SEA:'PAC', SJS:'PAC', VAN:'PAC', VGK:'PAC',
};
const DNAME: Record<string, string> = { ATL:'Atlantic', MET:'Metro', CEN:'Central', PAC:'Pacific' };

interface ST extends TeamStandings {
  seed: number;
  role: 'div1'|'div2'|'wc';
  cups: number;
  // Fields required by PlayoffDetailModal
  proj: number;
  playoffOdds: number;
  cupOdds: number;
}

function sortT(a: TeamStandings, b: TeamStandings) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.rw !== a.rw) return b.rw - a.rw;
  if (b.row !== a.row) return b.row - a.row;
  return b.wins - a.wins;
}

function seedConf(teams: TeamStandings[], d1: string, d2: string, sim: Record<string, SimResult>): ST[] {
  const t1  = teams.filter(t => DIV[t.tricode] === d1).sort(sortT);
  const t2  = teams.filter(t => DIV[t.tricode] === d2).sort(sortT);
  const wcs = [...t1.slice(3), ...t2.slice(3)].sort(sortT);
  const en  = (t: TeamStandings, seed: number, role: ST['role']): ST => {
    const s = sim[t.tricode];
    const total = s?.totalSims || 1;
    const cupPct = s ? (s.wonCup / total) * 100 : 0;
    return {
      ...t, seed, role,
      cups:        cupPct,
      proj:        s ? s.totalPoints / total : 0,
      playoffOdds: s ? (s.madePlayoffs / total) * 100 : 0,
      cupOdds:     cupPct,
    };
  };
  return [
    en(t1[0],1,'div1'), en(t1[1],2,'div1'), en(t1[2],3,'div1'),
    en(t2[0],4,'div2'), en(t2[1],5,'div2'), en(t2[2],6,'div2'),
    ...(wcs[0] ? [en(wcs[0],7,'wc')] : []),
    ...(wcs[1] ? [en(wcs[1],8,'wc')] : []),
  ];
}

// Largest-remainder allocation: distribute `total` cells across `weights`
function allocate(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const exact   = weights.map(w => (w / sum) * total);
  const floors  = exact.map(Math.floor);
  const remain  = total - floors.reduce((a, b) => a + b, 0);
  exact.map((v, i) => ({ i, r: v - floors[i] }))
    .sort((a, b) => b.r - a.r)
    .slice(0, remain)
    .forEach(({ i }) => floors[i]++);
  return floors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logo
// ─────────────────────────────────────────────────────────────────────────────

const Logo = ({ code, size = 22 }: { code: string; size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`/logos/${code}.svg`} alt={code} width={size} height={size}
    className="object-contain flex-shrink-0"
    onError={e => { (e.target as HTMLImageElement).style.opacity='0'; }} />
);

// ─────────────────────────────────────────────────────────────────────────────
// MatchupWaffle — single first-round series
// ─────────────────────────────────────────────────────────────────────────────

const MatchupWaffle: React.FC<{
  hi: ST; lo: ST; flip?: boolean;
  cols?: number; rows?: number; cs?: number;
  onClickTeam: (t: string) => void;
}> = ({ hi, lo, flip, cols = 8, rows = 6, cs = 5, onClickTeam }) => {
  const [hov, setHov] = useState(false);
  const brk = useMemo(() => seriesBreak(winProb(hi, lo)), [hi, lo]);
  const hC  = tc(hi.tricode), lC = tc(lo.tricode);
  const tot = cols * rows;
  const hN  = Math.round((brk.hw / 100) * tot);

  const seedBadge = (t: ST) => (
    <span className="text-[7px] font-black font-mono px-1 py-0.5 rounded"
      style={{ background: `${tc(t.tricode)}20`, color: tc(t.tricode) }}>
      {t.role === 'wc' ? 'WC' : t.seed}
    </span>
  );

  const teamRow = (t: ST, pct: number, right?: boolean) => (
    <button onClick={() => onClickTeam(t.tricode)}
      className={`flex items-center gap-1 hover:opacity-75 transition-opacity ${right ? 'flex-row-reverse' : ''}`}>
      {seedBadge(t)}
      <Logo code={t.tricode} size={16} />
      <span className="text-[10px] font-black font-mono leading-none" style={{ color: tc(t.tricode) }}>
        {Math.round(pct)}%
      </span>
    </button>
  );

  return (
    <div className="relative" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <div className="rounded-lg overflow-hidden cursor-pointer ring-1 ring-white/6 hover:ring-white/14 transition-all">
        <WaffleGrid segs={[{ color: hC, count: hN }, { color: lC, count: tot - hN }]}
          cols={cols} rows={rows} cs={cs} />
      </div>

      {/* Team labels below waffle */}
      <div className={`flex items-center justify-between mt-1.5 ${flip ? 'flex-row-reverse' : ''}`}>
        {teamRow(hi, brk.hw)}
        {teamRow(lo, brk.lw, true)}
      </div>

      {/* Tooltip */}
      {hov && (
        <div className="absolute z-50 bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-[#090b11]/96 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl pointer-events-none w-[210px]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1"><Logo code={hi.tricode} size={14} /><span className="text-[10px] font-black text-white">{hi.tricode}</span></div>
            <span className="text-[7px] text-white/25 uppercase tracking-wider">Series odds</span>
            <div className="flex items-center gap-1"><span className="text-[10px] font-black text-white">{lo.tricode}</span><Logo code={lo.tricode} size={14} /></div>
          </div>
          <div className="flex h-6 rounded-md overflow-hidden mb-2">
            <div className="flex items-center justify-center text-[8px] font-black text-white"
              style={{ width:`${brk.hw}%`, backgroundColor: hC }}>{brk.hw.toFixed(0)}%</div>
            <div className="flex items-center justify-center text-[8px] font-black text-white"
              style={{ width:`${brk.lw}%`, backgroundColor: lC }}>{brk.lw.toFixed(0)}%</div>
          </div>
          {brk.bars.map(b => (
            <div key={b.g} className="flex items-center justify-between py-0.5">
              <span className="text-[8px] font-bold font-mono" style={{ color: hC }}>{b.h.toFixed(0)}%</span>
              <span className="text-[7px] text-white/20 font-mono">in {b.g}</span>
              <span className="text-[8px] font-bold font-mono" style={{ color: lC }}>{b.l.toFixed(0)}%</span>
            </div>
          ))}
          <div className="mt-1.5 pt-1.5 border-t border-white/6 text-[7px] text-white/20 font-mono text-center">
            {hi.tricode} has home ice · click for full odds
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CupWaffle — N-team cup odds panel (division / conference / all)
// ─────────────────────────────────────────────────────────────────────────────

const CupWaffle: React.FC<{
  teams: ST[];
  cols: number; rows: number; cs?: number;
  label?: string;
  showLegend?: boolean;
  onClickTeam?: (t: string) => void;
}> = ({ teams, cols, rows, cs = 6, label, showLegend, onClickTeam }) => {
  const total  = cols * rows;
  const allocs = allocate(teams.map(t => t.cups), total);
  const segs   = teams.map((t, i) => ({ color: tc(t.tricode), count: allocs[i] }));

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div className="text-[7px] uppercase tracking-[0.3em] font-black text-white/25 text-center">
          {label}
        </div>
      )}
      <div className="rounded-lg overflow-hidden ring-1 ring-white/6">
        <WaffleGrid segs={segs} cols={cols} rows={rows} cs={cs} />
      </div>
      {showLegend && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 justify-center">
          {teams.filter(t => t.cups > 0.5).sort((a,b) => b.cups - a.cups).map(t => (
            <button key={t.tricode} onClick={() => onClickTeam?.(t.tricode)}
              className="flex items-center gap-0.5 hover:opacity-75 transition-opacity">
              <div className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ backgroundColor: tc(t.tricode) }} />
              <span className="text-[7px] font-mono text-white/35">{t.tricode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Bracket connector line (CSS border)
// ─────────────────────────────────────────────────────────────────────────────

const Conn = ({ dir }: { dir: 'ltr' | 'rtl' }) => (
  <div className="self-stretch flex items-center" style={{ width: 14, flexShrink: 0 }}>
    <div style={{
      width: 1, height: '100%',
      backgroundColor: 'rgba(255,255,255,0.08)',
      marginLeft: dir === 'ltr' ? 'auto' : 0,
      marginRight: dir === 'rtl' ? 'auto' : 0,
    }} />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SectionLabel
// ─────────────────────────────────────────────────────────────────────────────

const SLabel = ({ text, accent }: { text: string; accent?: string }) => (
  <div className="text-[8px] uppercase tracking-[0.25em] font-black text-center mb-1"
    style={{ color: accent ?? 'rgba(255,255,255,0.2)' }}>
    {text}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface PlayoffBracketProps {
  currentStandings: TeamStandings[];
  simResults: Record<string, SimResult>;
}

const PlayoffBracket: React.FC<PlayoffBracketProps> = ({ currentStandings, simResults }) => {
  const [selTricode, setSelTricode] = useState<string | null>(null);

  const { west, east } = useMemo(() => {
    if (!currentStandings.length) return { west: [] as ST[], east: [] as ST[] };
    const e = currentStandings.filter(t => ['ATL','MET'].includes(DIV[t.tricode] ?? ''));
    const w = currentStandings.filter(t => ['CEN','PAC'].includes(DIV[t.tricode] ?? ''));
    return {
      west: seedConf(w, 'CEN', 'PAC', simResults),
      east: seedConf(e, 'ATL', 'MET', simResults),
    };
  }, [currentStandings, simResults]);

  const selData = useMemo(
    () => [...west, ...east].find(t => t.tricode === selTricode) ?? null,
    [west, east, selTricode],
  );

  if (!currentStandings.length || !Object.keys(simResults).length) {
    return (
      <div className="flex justify-center items-center py-32">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-rose-500" />
      </div>
    );
  }

  const [w1,w2,w3,w4,w5,w6,w7,w8] = west;
  const [e1,e2,e3,e4,e5,e6,e7,e8] = east;

  // Division team groups
  const cenTeams = west.filter(t => DIV[t.tricode] === 'CEN');
  const pacTeams = west.filter(t => DIV[t.tricode] === 'PAC');
  const atlTeams = east.filter(t => DIV[t.tricode] === 'ATL');
  const metTeams = east.filter(t => DIV[t.tricode] === 'MET');

  // Cup final breakdown
  const cupBrk = useMemo(() =>
    w1 && e1 ? seriesBreak(winProb(w1, e1)) : null,
    [w1, e1],
  );

  // All 16 teams ordered by cup odds
  const all16 = useMemo(() =>
    [...west, ...east].sort((a, b) => b.cups - a.cups),
    [west, east],
  );

  // R1 waffle params
  const R1_COLS = 8; const R1_ROWS = 7; const R1_CS = 5;
  // Div waffle params
  const D_COLS  = 9; const D_ROWS  = 6; const D_CS  = 5;
  // Conf waffle params
  const C_COLS  = 9; const C_ROWS  = 7; const C_CS  = 6;
  // Center waffle params
  const CTR_COLS = 10; const CTR_ROWS = 10; const CTR_CS = 7;

  return (
    <div className="w-full select-none">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="text-center mb-6">
        <p className="text-[8px] uppercase tracking-[0.55em] text-white/20 font-black mb-1">
          Projected 2025–26
        </p>
        <h2 className="text-[26px] font-black text-white tracking-tight leading-none">
          Stanley Cup Bracket
        </h2>
        <p className="text-[8px] text-white/20 mt-1.5 font-mono">
          Waffle squares = probability · Hover any matchup for series breakdown · Click team for full playoff odds
        </p>
      </div>

      {/* ── Bracket ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto pb-4">
        <div className="flex items-stretch gap-0 justify-center mx-auto" style={{ minWidth: 980 }}>

          {/* ══ WEST R1 ══ */}
          <div className="flex flex-col gap-6 justify-around" style={{ width: 108 }}>
            {/* Central */}
            <div>
              <SLabel text={DNAME[DIV[w1?.tricode ?? ''] ?? ''] ?? 'Central'} accent="#f59e0b" />
              <div className="flex flex-col gap-2.5">
                {w1 && w8 && <MatchupWaffle hi={w1} lo={w8} cols={R1_COLS} rows={R1_ROWS} cs={R1_CS} onClickTeam={setSelTricode} />}
                {w2 && w3 && <MatchupWaffle hi={w2} lo={w3} cols={R1_COLS} rows={R1_ROWS} cs={R1_CS} onClickTeam={setSelTricode} />}
              </div>
            </div>
            {/* Pacific */}
            <div>
              <SLabel text={DNAME[DIV[w4?.tricode ?? ''] ?? ''] ?? 'Pacific'} accent="#38bdf8" />
              <div className="flex flex-col gap-2.5">
                {w4 && w7 && <MatchupWaffle hi={w4} lo={w7} cols={R1_COLS} rows={R1_ROWS} cs={R1_CS} onClickTeam={setSelTricode} />}
                {w5 && w6 && <MatchupWaffle hi={w5} lo={w6} cols={R1_COLS} rows={R1_ROWS} cs={R1_CS} onClickTeam={setSelTricode} />}
              </div>
            </div>
          </div>

          <Conn dir="ltr" />

          {/* ══ DIVISION CUP ODDS ══ */}
          <div className="flex flex-col gap-4 justify-around" style={{ width: 82 }}>
            <CupWaffle teams={cenTeams} cols={D_COLS} rows={D_ROWS} cs={D_CS}
              label={DNAME[DIV[w1?.tricode ?? ''] ?? ''] ?? ''}
              showLegend onClickTeam={setSelTricode} />
            <CupWaffle teams={pacTeams} cols={D_COLS} rows={D_ROWS} cs={D_CS}
              label={DNAME[DIV[w4?.tricode ?? ''] ?? ''] ?? ''}
              showLegend onClickTeam={setSelTricode} />
          </div>

          <Conn dir="ltr" />

          {/* ══ WEST CONFERENCE CUP ODDS ══ */}
          <div className="flex flex-col justify-center" style={{ width: 90 }}>
            <CupWaffle teams={west} cols={C_COLS} rows={C_ROWS} cs={C_CS}
              label="West" showLegend onClickTeam={setSelTricode} />
          </div>

          <Conn dir="ltr" />

          {/* ══ CENTER ══ */}
          <div className="flex flex-col items-center justify-center gap-4 px-2" style={{ width: 196, minWidth: 196 }}>

            {/* Stanley Cup mark */}
            <div className="flex flex-col items-center gap-0.5">
              {/* Clean SVG cup instead of emoji */}
              <svg width="32" height="36" viewBox="0 0 32 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-80">
                <path d="M10 2h12v6c0 5.523-2.686 10-6 10S10 13.523 10 8V2z" fill="#c8992a"/>
                <rect x="14" y="18" width="4" height="6" fill="#c8992a"/>
                <rect x="8" y="24" width="16" height="3" rx="1" fill="#c8992a"/>
                <rect x="6" y="27" width="20" height="2.5" rx="1" fill="#b8821a"/>
                <path d="M4 8h3v4a3 3 0 01-3-3V8zM25 8h3v1a3 3 0 01-3 3V8z" fill="#c8992a" opacity="0.7"/>
              </svg>
              <span className="text-[8px] uppercase tracking-[0.4em] font-black text-amber-400/60">
                Stanley Cup
              </span>
            </div>

            {/* Cup Final matchup waffle */}
            {w1 && e1 && cupBrk && (() => {
              const hC2 = tc(w1.tricode), lC2 = tc(e1.tricode);
              const tot2 = CTR_COLS * CTR_ROWS;
              const hN2 = Math.round((cupBrk.hw / 100) * tot2);
              return (
                <div className="flex flex-col items-center gap-2 w-full">
                  <div className="text-[7px] uppercase tracking-[0.3em] font-black text-amber-400/40">
                    Projected Final
                  </div>
                  <div className="rounded-xl overflow-hidden ring-1 ring-amber-400/15">
                    <WaffleGrid
                      segs={[{ color: hC2, count: hN2 }, { color: lC2, count: tot2 - hN2 }]}
                      cols={CTR_COLS} rows={CTR_ROWS} cs={CTR_CS}
                    />
                  </div>
                  {/* Teams below */}
                  <div className="flex items-center justify-between w-full px-1">
                    <button onClick={() => setSelTricode(w1.tricode)}
                      className="flex flex-col items-center gap-0.5 hover:opacity-75 transition-opacity">
                      <Logo code={w1.tricode} size={20} />
                      <span className="text-[9px] font-black font-mono" style={{ color: hC2 }}>
                        {Math.round(cupBrk.hw)}%
                      </span>
                    </button>
                    <span className="text-white/15 text-[7px] font-mono">vs</span>
                    <button onClick={() => setSelTricode(e1.tricode)}
                      className="flex flex-col items-center gap-0.5 hover:opacity-75 transition-opacity">
                      <Logo code={e1.tricode} size={20} />
                      <span className="text-[9px] font-black font-mono" style={{ color: lC2 }}>
                        {Math.round(cupBrk.lw)}%
                      </span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Divider */}
            <div className="w-full h-px bg-white/6" />

            {/* All 16 teams cup odds waffle */}
            <div className="flex flex-col items-center gap-1.5 w-full">
              <div className="text-[7px] uppercase tracking-[0.3em] font-black text-white/20">
                Cup Odds — All Teams
              </div>
              <div className="rounded-lg overflow-hidden ring-1 ring-white/6">
                <WaffleGrid
                  segs={allocate(all16.map(t => t.cups), 100).map((n, i) => ({
                    color: tc(all16[i].tricode), count: n,
                  }))}
                  cols={10} rows={10} cs={7}
                />
              </div>
              {/* Compact legend - top 8 */}
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 justify-center mt-0.5">
                {all16.filter(t => t.cups >= 0.5).slice(0, 10).map(t => (
                  <button key={t.tricode} onClick={() => setSelTricode(t.tricode)}
                    className="flex items-center gap-1 hover:opacity-75 transition-opacity">
                    <div className="w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: tc(t.tricode) }} />
                    <span className="text-[7px] font-mono text-white/30">{t.tricode}</span>
                    <span className="text-[7px] font-black font-mono" style={{ color: tc(t.tricode) }}>
                      {t.cups.toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Conn dir="rtl" />

          {/* ══ EAST CONFERENCE CUP ODDS ══ */}
          <div className="flex flex-col justify-center" style={{ width: 90 }}>
            <CupWaffle teams={east} cols={C_COLS} rows={C_ROWS} cs={C_CS}
              label="East" showLegend onClickTeam={setSelTricode} />
          </div>

          <Conn dir="rtl" />

          {/* ══ DIVISION CUP ODDS ══ */}
          <div className="flex flex-col gap-4 justify-around" style={{ width: 82 }}>
            <CupWaffle teams={atlTeams} cols={D_COLS} rows={D_ROWS} cs={D_CS}
              label={DNAME[DIV[e1?.tricode ?? ''] ?? ''] ?? ''}
              showLegend onClickTeam={setSelTricode} />
            <CupWaffle teams={metTeams} cols={D_COLS} rows={D_ROWS} cs={D_CS}
              label={DNAME[DIV[e4?.tricode ?? ''] ?? ''] ?? ''}
              showLegend onClickTeam={setSelTricode} />
          </div>

          <Conn dir="rtl" />

          {/* ══ EAST R1 ══ */}
          <div className="flex flex-col gap-6 justify-around" style={{ width: 108 }}>
            {/* Atlantic */}
            <div>
              <SLabel text={DNAME[DIV[e1?.tricode ?? ''] ?? ''] ?? 'Atlantic'} accent="#38bdf8" />
              <div className="flex flex-col gap-2.5">
                {e1 && e8 && <MatchupWaffle hi={e1} lo={e8} flip cols={R1_COLS} rows={R1_ROWS} cs={R1_CS} onClickTeam={setSelTricode} />}
                {e2 && e3 && <MatchupWaffle hi={e2} lo={e3} flip cols={R1_COLS} rows={R1_ROWS} cs={R1_CS} onClickTeam={setSelTricode} />}
              </div>
            </div>
            {/* Metro */}
            <div>
              <SLabel text={DNAME[DIV[e4?.tricode ?? ''] ?? ''] ?? 'Metro'} accent="#f59e0b" />
              <div className="flex flex-col gap-2.5">
                {e4 && e7 && <MatchupWaffle hi={e4} lo={e7} flip cols={R1_COLS} rows={R1_ROWS} cs={R1_CS} onClickTeam={setSelTricode} />}
                {e5 && e6 && <MatchupWaffle hi={e5} lo={e6} flip cols={R1_COLS} rows={R1_ROWS} cs={R1_CS} onClickTeam={setSelTricode} />}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Footer labels ─────────────────────────────────────────────── */}
      <div className="flex justify-center gap-3 mt-4">
        {(['Western Conference','Eastern Conference'] as const).map((n, i) => (
          <div key={n} className="text-[7px] uppercase tracking-[0.35em] font-black px-3 py-1 rounded-full"
            style={{
              color: i === 0 ? 'rgba(245,158,11,0.45)' : 'rgba(56,189,248,0.45)',
              border: `1px solid ${i === 0 ? 'rgba(245,158,11,0.1)' : 'rgba(56,189,248,0.1)'}`,
              background: i === 0 ? 'rgba(245,158,11,0.04)' : 'rgba(56,189,248,0.04)',
            }}>
            {n}
          </div>
        ))}
      </div>

      <p className="text-center text-[7px] text-white/12 font-mono mt-2">
        Chalk bracket from current standings · Division → Conference → Overall panels show cup win probability share · Hover matchups for series odds
      </p>

      {selTricode && selData && simResults[selTricode] && (
        <PlayoffDetailModal team={selData} simResult={simResults[selTricode]} onClose={() => setSelTricode(null)} />
      )}
    </div>
  );
};

export default PlayoffBracket;
