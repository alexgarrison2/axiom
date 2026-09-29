"use client";

import React, { useMemo, useState, useCallback } from 'react';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import { getTeamColor } from '@/utils/team-colors';
import PlayoffDetailModal from './PlayoffDetailModal';
import { SEASON_START_YEAR } from '@/lib/season';

// ─── Vivid color overrides for dark-bg legibility ─────────────────────────────
const VIVID: Record<string, string> = {
  EDM:'#FF4C00', WPG:'#5b8ee8', TOR:'#5b8ee8', TBL:'#3278d4',
  VAN:'#00943D', LAK:'#A8AEB5', SEA:'#7de0de', STL:'#5b8ee8',
  BUF:'#FCB514', PIT:'#FCB514', CBJ:'#CE1126', WSH:'#C8102E',
  NJD:'#CE1126', DET:'#CE1126', MIN:'#3a8f5a', COL:'#9B4060',
  NYR:'#0083C6', PHI:'#F74902', CAR:'#CE1126', FLA:'#C8102E',
  OTT:'#e21219', BOS:'#FCB514', CGY:'#D2001C', VGK:'#B4975A',
  ANA:'#F47A38', SJS:'#007889', NSH:'#FFB81C', CHI:'#CF0A2C',
  DAL:'#006847', MTL:'#AF1E2D',
};
function tc(code: string) { return VIVID[code] ?? getTeamColor(code); }

// ─── Division / conference maps ───────────────────────────────────────────────
const DIV: Record<string, string> = {
  BOS:'ATL',BUF:'ATL',DET:'ATL',FLA:'ATL',MTL:'ATL',OTT:'ATL',TBL:'ATL',TOR:'ATL',
  CAR:'MET',CBJ:'MET',NJD:'MET',NYI:'MET',NYR:'MET',PHI:'MET',PIT:'MET',WSH:'MET',
  CHI:'CEN',COL:'CEN',DAL:'CEN',MIN:'CEN',NSH:'CEN',STL:'CEN',UTA:'CEN',WPG:'CEN',
  ANA:'PAC',CGY:'PAC',EDM:'PAC',LAK:'PAC',SEA:'PAC',SJS:'PAC',VAN:'PAC',VGK:'PAC',
};
const DNAME: Record<string,string> = {
  ATL:'Atlantic', MET:'Metro', CEN:'Central', PAC:'Pacific',
};

// ─── Extended team type ───────────────────────────────────────────────────────
interface ST extends TeamStandings {
  seed: number; role: 'div1'|'div2'|'wc';
  div: string;
  cups: number; proj: number; playoffOdds: number; cupOdds: number;
}

// ─── Standings sort ───────────────────────────────────────────────────────────
function sortT(a: TeamStandings, b: TeamStandings) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.rw     !== a.rw)     return b.rw     - a.rw;
  if (b.row    !== a.row)    return b.row    - a.row;
  return b.wins - a.wins;
}

function seedConf(
  teams: TeamStandings[], d1: string, d2: string,
  sim: Record<string, SimResult>,
): ST[] {
  const t1  = teams.filter(t => DIV[t.tricode] === d1).sort(sortT);
  const t2  = teams.filter(t => DIV[t.tricode] === d2).sort(sortT);
  const wcs = [...t1.slice(3), ...t2.slice(3)].sort(sortT);
  const en  = (t: TeamStandings, seed: number, role: ST['role'], div: string): ST => {
    const s = sim[t.tricode]; const total = s?.totalSims || 1;
    const cupPct = s ? (s.wonCup / total) * 100 : 0;
    return { ...t, seed, role, div, cups: cupPct, proj: s ? s.totalPoints/total : 0,
      playoffOdds: s ? (s.madePlayoffs/total)*100 : 0, cupOdds: cupPct };
  };
  return [
    en(t1[0],1,'div1',d1), en(t1[1],2,'div1',d1), en(t1[2],3,'div1',d1),
    en(t2[0],4,'div2',d2), en(t2[1],5,'div2',d2), en(t2[2],6,'div2',d2),
    ...(wcs[0] ? [en(wcs[0],7,'wc', DIV[wcs[0].tricode]??d1)] : []),
    ...(wcs[1] ? [en(wcs[1],8,'wc', DIV[wcs[1].tricode]??d2)] : []),
  ];
}

// ─── Series probability math (Poisson) ────────────────────────────────────────
function fac(n: number): number { let r=1; for(let i=2;i<=n;i++) r*=i; return r; }
function choose(n: number, k: number) { return fac(n)/(fac(k)*fac(n-k)); }
function poisson(k: number, l: number) { return (l**k*Math.exp(-l))/fac(k); }

function winProb(home: TeamStandings, away: TeamStandings): number {
  const AVG=2.35, HI=0.16, ST=0.18;
  const h5=(home.xgf_5v5*away.xga_5v5)/AVG;
  const a5=(away.xgf_5v5*home.xga_5v5)/AVG;
  const hO=(home.pen_drawn_60+away.pen_taken_60)/2;
  const aO=(away.pen_drawn_60+home.pen_taken_60)/2;
  const hX=Math.max(0.1,h5+HI+hO*ST*home.pp_eff*away.pk_eff-away.goalie_rating*0.5);
  const aX=Math.max(0.1,a5+aO*ST*away.pp_eff*home.pk_eff-home.goalie_rating*0.5);
  let w=0,l=0,t=0;
  for(let h=0;h<12;h++) for(let a=0;a<12;a++) {
    const p=poisson(h,hX)*poisson(a,aX);
    if(h>a) w+=p; else if(a>h) l+=p; else t+=p;
  }
  const tot=w+l+t;
  return (w/tot)+(t/tot)*(hX/(hX+aX));
}

interface SeriesBreak { hw: number; lw: number; bars:{g:number;h:number;l:number}[] }
function seriesBreak(p: number): SeriesBreak {
  let hw=0, lw=0;
  const bars=[4,5,6,7].map(g=>{
    const ways=choose(g-1,3);
    const ph=ways*p**4*(1-p)**(g-4);
    const pl=ways*(1-p)**4*p**(g-4);
    hw+=ph; lw+=pl;
    return {g, h:ph*100, l:pl*100};
  });
  return {hw:hw*100, lw:lw*100, bars};
}

// ─── Color interpolation for win% badge ───────────────────────────────────────
// Blue (#4484b0) at high % → Red (#a33c54) at low %
function pctColor(pct: number): string {
  const t = pct / 100; // 0=loss, 1=win
  const r = Math.round(163 + (68 - 163) * t);
  const g = Math.round(60 + (132 - 60) * t);
  const b = Math.round(84 + (176 - 84) * t);
  return `rgb(${r},${g},${b})`;
}

// ─── Logo component ───────────────────────────────────────────────────────────
const Logo = ({ code, size = 48 }: { code: string; size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`/logos/${code}.svg`} alt={`${code} logo`} width={size} height={size}
    className="object-contain shrink-0"
    style={{
      filter: 'drop-shadow(0 1.8px 4.8px rgba(0,0,0,0.6))',
      transform: 'scale(1.25)',
      width: size, height: size,
    }}
    onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }} />
);

// ─── Slot types ───────────────────────────────────────────────────────────────
type SlotKey =
  // West R1
  | 'w_r1_c1' | 'w_r1_c2' | 'w_r1_p1' | 'w_r1_p2'
  // West R2
  | 'w_r2_1' | 'w_r2_2'
  // West CF
  | 'w_cf'
  // East R1
  | 'e_r1_a1' | 'e_r1_a2' | 'e_r1_m1' | 'e_r1_m2'
  // East R2
  | 'e_r2_1' | 'e_r2_2'
  // East CF
  | 'e_cf'
  // SCF
  | 'scf';

// Links: which R1 matchup feeds into which R2, etc.
// Value = [slotA, slotB] meaning winner of slotA matchup and winner of slotB go into this slot
type FeedMap = Record<SlotKey, [SlotKey, SlotKey] | null>;

// ─── Matchup Card ─────────────────────────────────────────────────────────────
interface MatchupCardProps {
  teamA: ST | null;
  teamB: ST | null;
  divLabel?: string;
  onAdvance: (team: ST) => void;
  onClickTeamDetail: (tricode: string) => void;
}

const MatchupCard: React.FC<MatchupCardProps> = ({ teamA, teamB, divLabel, onAdvance, onClickTeamDetail }) => {
  const [hov, setHov] = useState(false);

  const brk = useMemo(() => {
    if (!teamA || !teamB) return null;
    return seriesBreak(winProb(teamA, teamB));
  }, [teamA, teamB]);

  if (!teamA && !teamB) {
    // Empty TBD card
    return (
      <div style={{ width: 148 }}>
        {divLabel && (
          <h2 className="text-[11px] mb-1 text-center uppercase tracking-widest font-medium text-gray-400">
            {divLabel}
          </h2>
        )}
        <div className="rounded-lg overflow-hidden border border-blue-800/40 shadow-lg shadow-blue-900/20 bg-gradient-to-br from-[#15202b] to-[#192f45]">
          <div className="flex items-center gap-1.5 pl-2.5 pr-3 py-1 min-h-[56px]">
            <span className="text-base italic text-gray-500">TBD</span>
            <div className="ml-auto flex items-center gap-1.5" />
          </div>
          <div className="border-t border-blue-800/30" />
          <div className="flex items-center gap-1.5 pl-2.5 pr-3 py-1 min-h-[56px]">
            <span className="text-base italic text-gray-500">TBD</span>
            <div className="ml-auto flex items-center gap-1.5" />
          </div>
        </div>
      </div>
    );
  }

  // Partial TBD: one team filled, one not
  if (!teamA || !teamB) {
    const filled = teamA || teamB;
    const filledColor = tc(filled!.tricode);
    return (
      <div style={{ width: 148 }}>
        {divLabel && (
          <h2 className="text-[11px] mb-1 text-center uppercase tracking-widest font-medium text-gray-400">
            {divLabel}
          </h2>
        )}
        <div className="rounded-lg overflow-hidden border border-blue-800/40 shadow-lg shadow-blue-900/20 bg-gradient-to-br from-[#15202b] to-[#192f45]">
          {teamA ? (
            <TeamRow team={teamA} pct={null} color={filledColor} onClick={() => {}} onDetail={() => onClickTeamDetail(teamA.tricode)} />
          ) : (
            <div className="flex items-center gap-1.5 pl-2.5 pr-3 py-1 min-h-[56px]">
              <span className="text-base italic text-gray-500">TBD</span>
              <div className="ml-auto flex items-center gap-1.5" />
            </div>
          )}
          <div className="border-t border-blue-800/30" />
          {teamB ? (
            <TeamRow team={teamB} pct={null} color={filledColor} onClick={() => {}} onDetail={() => onClickTeamDetail(teamB.tricode)} />
          ) : (
            <div className="flex items-center gap-1.5 pl-2.5 pr-3 py-1 min-h-[56px]">
              <span className="text-base italic text-gray-500">TBD</span>
              <div className="ml-auto flex items-center gap-1.5" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full matchup — both teams present
  const aPct = Math.round(brk!.hw);
  const bPct = Math.round(brk!.lw);

  return (
    <div style={{ width: 148 }} className="relative"
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {divLabel && (
        <h2 className="text-[11px] mb-1 text-center uppercase tracking-widest font-medium text-gray-400">
          {divLabel}
        </h2>
      )}
      <div className="rounded-lg overflow-hidden border border-blue-800/40 shadow-lg shadow-blue-900/20 bg-gradient-to-br from-[#15202b] to-[#192f45]">
        <TeamRow team={teamA} pct={aPct} color={tc(teamA.tricode)}
          onClick={() => onAdvance(teamA)} onDetail={() => onClickTeamDetail(teamA.tricode)} />
        <div className="border-t border-blue-800/30" />
        <TeamRow team={teamB} pct={bPct} color={tc(teamB.tricode)}
          onClick={() => onAdvance(teamB)} onDetail={() => onClickTeamDetail(teamB.tricode)} />
      </div>

      {/* Hover tooltip — always below the card */}
      {hov && brk && (
        <div className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2
                        bg-[#0d1520]/95 backdrop-blur-xl border border-blue-700/40
                        rounded-lg p-3 shadow-2xl pointer-events-none"
          style={{ width: 230 }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <Logo code={teamA.tricode} size={18} />
              <span className="text-[11px] font-bold text-white">{teamA.tricode}</span>
            </div>
            <span className="text-[9px] text-white/25 uppercase tracking-wider font-medium">Series</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-white">{teamB.tricode}</span>
              <Logo code={teamB.tricode} size={18} />
            </div>
          </div>
          {/* Win % bar */}
          <div className="flex h-6 rounded overflow-hidden mb-3">
            <div className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{ width: `${brk.hw}%`, backgroundColor: tc(teamA.tricode) }}>
              {brk.hw.toFixed(0)}%
            </div>
            <div className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{ width: `${brk.lw}%`, backgroundColor: tc(teamB.tricode) }}>
              {brk.lw.toFixed(0)}%
            </div>
          </div>
          {/* Game breakdown */}
          <div className="space-y-1">
            {brk.bars.map(b => (
              <div key={b.g} className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold font-mono w-10 text-right" style={{ color: tc(teamA.tricode) }}>
                  {b.h.toFixed(0)}%
                </span>
                <span className="text-[9px] text-white/30 font-mono flex-1 text-center">
                  in {b.g}
                </span>
                <span className="text-[10px] font-bold font-mono w-10" style={{ color: tc(teamB.tricode) }}>
                  {b.l.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Team Row (single team within a matchup card) ─────────────────────────────
interface TeamRowProps {
  team: ST;
  pct: number | null;
  color: string;
  onClick: () => void;
  onDetail: () => void;
}

const TeamRow: React.FC<TeamRowProps> = ({ team, pct, color, onClick, onDetail }) => {
  const gradBg = `linear-gradient(135deg, ${color}33 0%, transparent 60%)`;
  return (
    <div
      className="flex items-center gap-1.5 pl-2.5 pr-3 py-1 min-h-[56px] transition-all duration-150 cursor-pointer hover:brightness-125 group relative"
      style={{ background: gradBg }}
      onClick={onClick}
    >
      <div className="shrink-0 relative">
        <Logo code={team.tricode} size={48} />
        {/* Info button — appears on hover, opens detail modal */}
        <button
          onClick={(e) => { e.stopPropagation(); onDetail(); }}
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-blue-500/70 text-white text-[8px] font-bold
                     flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-400 z-10"
          title="View team details"
        >
          i
        </button>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {pct !== null && (
          <span className="text-lg font-bold py-1 px-2.5 rounded min-w-[54px] text-center inline-block text-white"
            style={{ backgroundColor: pctColor(pct) }}>
            {pct}%
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Bracket connector lines ──────────────────────────────────────────────────
// Matches the hockeystats.com SVG connector geometry exactly
interface ConnectorProps {
  topY: number;      // Y of top input line
  botY: number;      // Y of bottom input line
  outY: number;      // Y of output line (midpoint)
  dir: 'ltr' | 'rtl';
  height: number;
}

const Connector: React.FC<ConnectorProps> = ({ topY, botY, outY, dir, height }) => {
  const w = 28;
  return (
    <div className="relative shrink-0" style={{ width: w, height }}>
      {/* Top horizontal */}
      <div className="absolute border-t-2 border-blue-700/40"
        style={{
          top: topY,
          [dir === 'ltr' ? 'left' : 'right']: 0,
          width: '50%',
        }} />
      {/* Bottom horizontal */}
      <div className="absolute border-t-2 border-blue-700/40"
        style={{
          top: botY,
          [dir === 'ltr' ? 'left' : 'right']: 0,
          width: '50%',
        }} />
      {/* Vertical bar */}
      <div className="absolute border-l-2 border-blue-700/40"
        style={{
          top: topY,
          height: botY - topY,
          left: '50%',
        }} />
      {/* Output horizontal */}
      <div className="absolute border-t-2 border-blue-700/40"
        style={{
          top: outY,
          [dir === 'ltr' ? 'right' : 'left']: 0,
          width: '50%',
        }} />
    </div>
  );
};

// Simple straight connector for CF → SCF
const StraightConnector: React.FC<{ y: number; height: number }> = ({ y, height }) => (
  <div className="relative shrink-0" style={{ width: 28, height }}>
    <div className="absolute left-0 right-0 border-t-2 border-blue-700/40"
      style={{ top: y }} />
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
interface PlayoffBracketProps {
  currentStandings: TeamStandings[];
  simResults: Record<string, SimResult>;
}

// Bracket slot positions (matching hockeystats geometry)
// Card height = 56+56+1 = 113px (two 56px rows + 1px divider)
// With division label: +20px above
const BH = 591;       // Total bracket height
const CARD_H = 113;   // Card height (2 × 56px rows + 1px divider)
const DIV_LABEL_H = 20; // Division label height

// Y-centers for first round matchups (top of card area)
const W_R1_TOPS = [24, 169, 314, 459];  // West: C1, C2, P1, P2 (from reference HTML)
const E_R1_TOPS = [24, 169, 314, 459];  // East: A1, A2, M1, M2

// Card midpoints (for connector lines)
const cardMid = (top: number, hasDivLabel: boolean) =>
  top + (hasDivLabel ? DIV_LABEL_H : 0) + CARD_H / 2;

// R1 midpoints
const W_R1_MIDS = [
  cardMid(W_R1_TOPS[0], true),   // ~81
  cardMid(W_R1_TOPS[1], false),  // ~225.5
  cardMid(W_R1_TOPS[2], true),   // ~371
  cardMid(W_R1_TOPS[3], false),  // ~515.5
];

// R2 positions — midpoint between pairs
const W_R2_TOP_1 = 96.75;   // Between C1/C2 midpoints
const W_R2_TOP_2 = 386.75;  // Between P1/P2 midpoints
const W_R2_MIDS = [W_R2_TOP_1 + CARD_H / 2, W_R2_TOP_2 + CARD_H / 2];

// CF position — midpoint between R2 pair
const CF_TOP = 242;
const CF_MID = CF_TOP + CARD_H / 2;  // ~299

// SCF position — same as CF
const SCF_TOP = 242;

export default function PlayoffBracket({ currentStandings, simResults }: PlayoffBracketProps) {
  const [selTricode, setSelTricode] = useState<string | null>(null);

  // ── Bracket state: user selections ──
  // Keys map to R2, CF, SCF slots. Values are the tricode of the advanced team.
  const [picks, setPicks] = useState<Record<string, string>>({});

  const { west, east } = useMemo(() => {
    if (!currentStandings.length) return { west: [] as ST[], east: [] as ST[] };
    const e = currentStandings.filter(t => ['ATL', 'MET'].includes(DIV[t.tricode] ?? ''));
    const w = currentStandings.filter(t => ['CEN', 'PAC'].includes(DIV[t.tricode] ?? ''));
    return {
      west: seedConf(w, 'CEN', 'PAC', simResults),
      east: seedConf(e, 'ATL', 'MET', simResults),
    };
  }, [currentStandings, simResults]);

  const teamMap = useMemo(() => {
    const m: Record<string, ST> = {};
    [...west, ...east].forEach(t => { m[t.tricode] = t; });
    return m;
  }, [west, east]);

  const selData = useMemo(
    () => [...west, ...east].find(t => t.tricode === selTricode) ?? null,
    [west, east, selTricode],
  );

  // ── Build matchup slots from seeding + picks ──
  // Downstream slots that should be cleared when a pick changes
  const downstream: Record<string, string[]> = {
    'w_r2_1': ['w_cf', 'scf'],
    'w_r2_2': ['w_cf', 'scf'],
    'w_cf': ['scf'],
    'e_r2_1': ['e_cf', 'scf'],
    'e_r2_2': ['e_cf', 'scf'],
    'e_cf': ['scf'],
    'scf': [],
  };

  const advanceTeam = useCallback((slotKey: string, team: ST) => {
    setPicks(prev => {
      const next = { ...prev };
      // If this same team is already picked, do nothing
      if (next[slotKey] === team.tricode) return prev;
      // Set pick
      next[slotKey] = team.tricode;
      // Clear downstream
      const toClear = downstream[slotKey] ?? [];
      toClear.forEach(k => { delete next[k]; });
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetBracket = useCallback(() => {
    setPicks({});
  }, []);

  if (!currentStandings.length || !Object.keys(simResults).length) {
    return (
      <div className="flex justify-center items-center py-32">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-500" />
      </div>
    );
  }

  const [w1, w2, w3, w4, w5, w6, w7, w8] = west;
  const [e1, e2, e3, e4, e5, e6, e7, e8] = east;

  if (!w1 || !w2 || !w3 || !w4 || !w5 || !w6 || !w7 || !w8 ||
      !e1 || !e2 || !e3 || !e4 || !e5 || !e6 || !e7 || !e8) {
    return <div className="text-center text-white/30 py-20 text-sm">Awaiting playoff field…</div>;
  }

  // ── R1 matchups (fixed from seeding) ──
  // West: C1vWC2, C2vC3, P1vWC1, P2vP3
  const wR1 = [
    { a: w1, b: w8 }, // Central 1 vs WC2
    { a: w2, b: w3 }, // Central 2 vs Central 3
    { a: w4, b: w7 }, // Pacific 1 vs WC1
    { a: w5, b: w6 }, // Pacific 2 vs Pacific 3
  ];
  // East: A1vWC2, A2vA3, M1vWC1, M2vM3
  const eR1 = [
    { a: e1, b: e8 },
    { a: e2, b: e3 },
    { a: e4, b: e7 },
    { a: e5, b: e6 },
  ];

  // ── R2 matchups (from user picks) ──
  const wR2_1_a = picks['w_r2_1'] ? teamMap[picks['w_r2_1']] : null;  // Winner of C1vWC2
  const wR2_1_b = picks['w_r2_1b'] ? teamMap[picks['w_r2_1b']] : null; // Winner of C2vC3

  // Wait — we need to rethink this. The picks dict maps a SLOT to a team.
  // When user clicks a team in R1 matchup 0 (C1vWC2), it should fill half of R2 slot 1.
  // R2_1 = winner(R1_0) vs winner(R1_1)
  // R2_2 = winner(R1_2) vs winner(R1_3)

  // Let's use feed keys: r1_top feeds first half of R2, r1_bot feeds second half
  const getTeam = (key: string): ST | null => {
    const tri = picks[key];
    return tri ? teamMap[tri] ?? null : null;
  };

  // R2 matchup teams
  const wR2_1_top = getTeam('w_r1_0');  // Winner of wR1[0]
  const wR2_1_bot = getTeam('w_r1_1');  // Winner of wR1[1]
  const wR2_2_top = getTeam('w_r1_2');  // Winner of wR1[2]
  const wR2_2_bot = getTeam('w_r1_3');  // Winner of wR1[3]

  const eR2_1_top = getTeam('e_r1_0');
  const eR2_1_bot = getTeam('e_r1_1');
  const eR2_2_top = getTeam('e_r1_2');
  const eR2_2_bot = getTeam('e_r1_3');

  // CF matchup teams
  const wCF_top = getTeam('w_r2_1');  // Winner of wR2[0]
  const wCF_bot = getTeam('w_r2_2');  // Winner of wR2[1]
  const eCF_top = getTeam('e_r2_1');
  const eCF_bot = getTeam('e_r2_2');

  // SCF
  const scf_west = getTeam('w_cf');
  const scf_east = getTeam('e_cf');

  // Division names
  const wD1 = DNAME[DIV[w1.tricode] ?? ''] ?? 'Central';
  const wD2 = DNAME[DIV[w4.tricode] ?? ''] ?? 'Pacific';
  const eD1 = DNAME[DIV[e1.tricode] ?? ''] ?? 'Atlantic';
  const eD2 = DNAME[DIV[e4.tricode] ?? ''] ?? 'Metro';

  // Advance handlers — map R1 clicks to slot keys
  const makeR1Advance = (feedKey: string, downstreamKeys: string[]) => (team: ST) => {
    setPicks(prev => {
      const next = { ...prev };
      if (next[feedKey] === team.tricode) return prev;
      next[feedKey] = team.tricode;
      // Clear all downstream
      downstreamKeys.forEach(k => delete next[k]);
      return next;
    });
  };

  const advW_r1_0 = makeR1Advance('w_r1_0', ['w_r2_1', 'w_cf', 'scf']);
  const advW_r1_1 = makeR1Advance('w_r1_1', ['w_r2_1', 'w_cf', 'scf']);
  const advW_r1_2 = makeR1Advance('w_r1_2', ['w_r2_2', 'w_cf', 'scf']);
  const advW_r1_3 = makeR1Advance('w_r1_3', ['w_r2_2', 'w_cf', 'scf']);

  const advE_r1_0 = makeR1Advance('e_r1_0', ['e_r2_1', 'e_cf', 'scf']);
  const advE_r1_1 = makeR1Advance('e_r1_1', ['e_r2_1', 'e_cf', 'scf']);
  const advE_r1_2 = makeR1Advance('e_r1_2', ['e_r2_2', 'e_cf', 'scf']);
  const advE_r1_3 = makeR1Advance('e_r1_3', ['e_r2_2', 'e_cf', 'scf']);

  const advW_r2_1 = makeR1Advance('w_r2_1', ['w_cf', 'scf']);
  const advW_r2_2 = makeR1Advance('w_r2_2', ['w_cf', 'scf']);
  const advE_r2_1 = makeR1Advance('e_r2_1', ['e_cf', 'scf']);
  const advE_r2_2 = makeR1Advance('e_r2_2', ['e_cf', 'scf']);

  const advW_cf = makeR1Advance('w_cf', ['scf']);
  const advE_cf = makeR1Advance('e_cf', ['scf']);

  // Check if any picks have been made
  const hasPicks = Object.keys(picks).length > 0;

  return (
    <div className="w-full select-none">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="text-center mb-0 sm:mb-2 pt-3 sm:pt-4">
        <h2 className="text-3xl sm:text-4xl relative font-bold italic overflow-hidden uppercase text-white"
          style={{ fontFamily: "'Arial Black Italic', 'Arial Black', sans-serif", fontStyle: 'italic' }}>
          <span className="relative inline-block">
            NHL Playoff Bracket ({SEASON_START_YEAR + 1})
            <span className="absolute -bottom-2 left-0 w-full h-0.5 bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-600 rounded-full" />
          </span>
        </h2>
      </div>

      {/* ── Subtitle + Reset ─────────────────────────────────────────── */}
      <div className="text-center px-4 pb-2">
        <p className="text-sm leading-relaxed text-gray-400">If the playoffs started today*</p>
        <p className="text-xs text-gray-500 mt-1">
          Click a team to advance them · Hover matchups for series breakdown
        </p>
        {hasPicks && (
          <button onClick={resetBracket}
            className="mt-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-400 border border-blue-500/30 rounded-full hover:bg-blue-500/10 transition-colors">
            Reset Bracket
          </button>
        )}
      </div>

      {/* ── Bracket ─────────────────────────────────────────────────────── */}
      <div className="w-full pb-4 px-2 md:px-8 text-white">
        <div className="relative">
          <div className="flex justify-start md:justify-center pb-4 relative" style={{ overflowX: 'auto', overflowY: 'visible' }}>
            <div className="flex items-start gap-0 relative">

              {/* ═══ West R1 ═══ */}
              <div className="relative shrink-0" style={{ width: 148, height: BH }}>
                {wR1.map((m, i) => (
                  <div key={`wr1_${i}`} className="absolute left-0" style={{ top: W_R1_TOPS[i] }}>
                    <MatchupCard
                      teamA={m.a} teamB={m.b}
                      divLabel={i === 0 ? wD1 : i === 2 ? wD2 : undefined}
                      onAdvance={[advW_r1_0, advW_r1_1, advW_r1_2, advW_r1_3][i]}
                      onClickTeamDetail={setSelTricode}
                    />
                  </div>
                ))}
              </div>

              {/* R1→R2 connector (West) */}
              <div className="relative shrink-0" style={{ width: 28, height: BH }}>
                {/* Top pair: R1[0] mid → R1[1] mid → R2[0] mid */}
                <Connector topY={W_R1_MIDS[0]} botY={W_R1_MIDS[1]}
                  outY={(W_R1_MIDS[0] + W_R1_MIDS[1]) / 2} dir="ltr" height={BH} />
                {/* Bottom pair: R1[2] mid → R1[3] mid → R2[1] mid */}
                <div className="absolute inset-0">
                  <Connector topY={W_R1_MIDS[2]} botY={W_R1_MIDS[3]}
                    outY={(W_R1_MIDS[2] + W_R1_MIDS[3]) / 2} dir="ltr" height={BH} />
                </div>
              </div>

              {/* ═══ West R2 ═══ */}
              <div className="relative shrink-0" style={{ width: 148, height: BH }}>
                <div className="absolute left-0" style={{ top: W_R2_TOP_1 }}>
                  <MatchupCard teamA={wR2_1_top} teamB={wR2_1_bot}
                    divLabel="Round 2"
                    onAdvance={advW_r2_1}
                    onClickTeamDetail={setSelTricode} />
                </div>
                <div className="absolute left-0" style={{ top: W_R2_TOP_2 }}>
                  <MatchupCard teamA={wR2_2_top} teamB={wR2_2_bot}
                    onAdvance={advW_r2_2}
                    onClickTeamDetail={setSelTricode} />
                </div>
              </div>

              {/* R2→CF connector (West) */}
              <div className="relative shrink-0" style={{ width: 28, height: BH }}>
                <Connector topY={W_R2_MIDS[0]} botY={W_R2_MIDS[1]}
                  outY={CF_MID} dir="ltr" height={BH} />
              </div>

              {/* ═══ West CF ═══ */}
              <div className="relative shrink-0" style={{ width: 148, height: BH }}>
                <div className="absolute left-0" style={{ top: CF_TOP }}>
                  <MatchupCard teamA={wCF_top} teamB={wCF_bot}
                    divLabel="West Final"
                    onAdvance={advW_cf}
                    onClickTeamDetail={setSelTricode} />
                </div>
              </div>

              {/* CF→SCF connector (West) */}
              <StraightConnector y={CF_MID} height={BH} />

              {/* ═══ Stanley Cup Final ═══ */}
              <div className="relative shrink-0" style={{ width: 148, height: BH }}>
                <div className="absolute left-0" style={{ top: SCF_TOP }}>
                  <MatchupCard teamA={scf_west} teamB={scf_east}
                    divLabel="Stanley Cup Final"
                    onAdvance={() => {}}
                    onClickTeamDetail={setSelTricode} />
                </div>
              </div>

              {/* SCF→CF connector (East) */}
              <StraightConnector y={CF_MID} height={BH} />

              {/* ═══ East CF ═══ */}
              <div className="relative shrink-0" style={{ width: 148, height: BH }}>
                <div className="absolute left-0" style={{ top: CF_TOP }}>
                  <MatchupCard teamA={eCF_top} teamB={eCF_bot}
                    divLabel="East Final"
                    onAdvance={advE_cf}
                    onClickTeamDetail={setSelTricode} />
                </div>
              </div>

              {/* CF→R2 connector (East) */}
              <div className="relative shrink-0" style={{ width: 28, height: BH }}>
                <Connector topY={W_R2_MIDS[0]} botY={W_R2_MIDS[1]}
                  outY={CF_MID} dir="rtl" height={BH} />
              </div>

              {/* ═══ East R2 ═══ */}
              <div className="relative shrink-0" style={{ width: 148, height: BH }}>
                <div className="absolute left-0" style={{ top: W_R2_TOP_1 }}>
                  <MatchupCard teamA={eR2_1_top} teamB={eR2_1_bot}
                    divLabel="Round 2"
                    onAdvance={advE_r2_1}
                    onClickTeamDetail={setSelTricode} />
                </div>
                <div className="absolute left-0" style={{ top: W_R2_TOP_2 }}>
                  <MatchupCard teamA={eR2_2_top} teamB={eR2_2_bot}
                    onAdvance={advE_r2_2}
                    onClickTeamDetail={setSelTricode} />
                </div>
              </div>

              {/* R2→R1 connector (East) */}
              <div className="relative shrink-0" style={{ width: 28, height: BH }}>
                <Connector topY={W_R1_MIDS[0]} botY={W_R1_MIDS[1]}
                  outY={(W_R1_MIDS[0] + W_R1_MIDS[1]) / 2} dir="rtl" height={BH} />
                <div className="absolute inset-0">
                  <Connector topY={W_R1_MIDS[2]} botY={W_R1_MIDS[3]}
                    outY={(W_R1_MIDS[2] + W_R1_MIDS[3]) / 2} dir="rtl" height={BH} />
                </div>
              </div>

              {/* ═══ East R1 ═══ */}
              <div className="relative shrink-0" style={{ width: 148, height: BH }}>
                {eR1.map((m, i) => (
                  <div key={`er1_${i}`} className="absolute left-0" style={{ top: E_R1_TOPS[i] }}>
                    <MatchupCard
                      teamA={m.a} teamB={m.b}
                      divLabel={i === 0 ? eD1 : i === 2 ? eD2 : undefined}
                      onAdvance={[advE_r1_0, advE_r1_1, advE_r1_2, advE_r1_3][i]}
                      onClickTeamDetail={setSelTricode}
                    />
                  </div>
                ))}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── Info box ─────────────────────────────────────────────────────── */}
      <div className="w-full pb-8 pt-0 px-2 md:px-8 -mt-2">
        <div className="max-w-4xl mx-auto">
          <div className="p-4 border rounded-lg shadow-lg border-blue-700/30 bg-[#15202b]/80">
            <h3 className="text-sm font-semibold mb-2 text-blue-300">*If the Playoffs Started Today</h3>
            <p className="text-xs leading-relaxed text-gray-400">
              This bracket shows projected first-round matchups based on current standings. Click on a team to advance them and see
              updated win probabilities for the next round, computed via 10,000 Poisson-based series simulations.
              Hover any matchup to see the probability of winning in 4, 5, 6, or 7 games.
            </p>
          </div>
        </div>
      </div>

      {/* ── Detail Modal ─────────────────────────────────────────────────── */}
      {selTricode && selData && simResults[selTricode] && (
        <PlayoffDetailModal
          team={selData}
          simResult={simResults[selTricode]}
          onClose={() => setSelTricode(null)}
        />
      )}
    </div>
  );
}
