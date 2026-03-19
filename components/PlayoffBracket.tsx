"use client";

import React, { useMemo, useState } from 'react';
import { TeamStandings, SimResult } from '@/utils/simulation-engine';
import { getTeamColor } from '@/utils/team-colors';
import PlayoffDetailModal from './PlayoffDetailModal';

// ─── Color overrides for dark-bg legibility ──────────────────────────────────
const VIVID: Record<string, string> = {
  EDM:'#FF4C00', WPG:'#5b8ee8', TOR:'#5b8ee8', TBL:'#3278d4',
  VAN:'#00943D', LAK:'#A8AEB5', SEA:'#7de0de', STL:'#5b8ee8',
  BUF:'#FCB514', PIT:'#FCB514', CBJ:'#CE1126', WSH:'#C8102E',
  NJD:'#CE1126', DET:'#CE1126', MIN:'#3a8f5a', COL:'#9B4060',
  NYR:'#0083C6', PHI:'#F74902', CAR:'#CE1126', FLA:'#C8102E',
  OTT:'#e21219', BOS:'#FCB514', CGY:'#D2001C', VGK:'#B4975A',
  ANA:'#F47A38', SJS:'#007889', NSH:'#FFB81C', CHI:'#CF0A2C',
  DAL:'#006847', MTL:'#AF1E2D', WPG2:'#5b8ee8',
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
  ATL:'Atlantic', MET:'Metropolitan', CEN:'Central', PAC:'Pacific',
};
const DIV_ABBR: Record<string, string> = { CEN:'C', PAC:'P', ATL:'A', MET:'M' };

// ─── Extended team type ───────────────────────────────────────────────────────
interface ST extends TeamStandings {
  seed: number; role: 'div1'|'div2'|'wc';
  div: string;
  cups: number; proj: number; playoffOdds: number; cupOdds: number;
}

function seedLabel(t: ST): string {
  if (t.role === 'wc') return `WC${t.seed - 6}`;
  const rank = t.role === 'div1' ? t.seed : t.seed - 3;
  return `${DIV_ABBR[t.div] ?? '?'}${rank}`;
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

// ─── Logo ─────────────────────────────────────────────────────────────────────
const Logo = ({ code, size = 24 }: { code: string; size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`/logos/${code}.svg`} alt={code} width={size} height={size}
    className="object-contain flex-shrink-0"
    onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }} />
);

// ─── WaffleGrid ───────────────────────────────────────────────────────────────
interface WafSeg { color: string; count: number }
const WaffleGrid: React.FC<{
  segs: WafSeg[]; cols: number; rows: number;
  cs?: number; gap?: number; rx?: number; empty?: string;
}> = ({ segs, cols, rows, cs=12, gap=1, rx=1.5, empty='#0c0e1c' }) => {
  const total = cols * rows;
  const step  = cs + gap;
  const cells: string[] = [];
  for (const s of segs) for (let i = 0; i < s.count && cells.length < total; i++) cells.push(s.color);
  while (cells.length < total) cells.push(empty);
  return (
    <svg width={cols*step - gap} height={rows*step - gap} style={{ display:'block' }}>
      {cells.map((c, i) => (
        <rect key={i} x={(i%cols)*step} y={Math.floor(i/cols)*step}
          width={cs} height={cs} fill={c} rx={rx} />
      ))}
    </svg>
  );
};

// ─── Series probability math ──────────────────────────────────────────────────
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

// ─── Chalk advance helper ─────────────────────────────────────────────────────
function chalk(a: ST, b: ST): ST {
  return seriesBreak(winProb(a, b)).hw >= 50 ? a : b;
}
function matchup(a: ST, b: ST): {hi:ST; lo:ST} {
  return a.cups >= b.cups ? {hi:a, lo:b} : {hi:b, lo:a};
}

// ─── Right-angle bracket connector ───────────────────────────────────────────
// Classic tournament bracket shape: horizontal lines from each input card meet
// a single vertical bar; the bar's midpoint then runs horizontal to the output.
// Creates the distinctive "]" (LTR) or "[" (RTL) bracket appearance.

const BH = 800;

// Figma-derived Y positions (per node coordinate data from the design file)
const DIV_Y: [number, number] = [288, 512];   // Div Final card centers
const CF_Y  = BH / 2;                          // CF card center = 400
const SCF_Y = 100;                             // SCF card center (top-aligned)

const Conn: React.FC<{
  inputs: number; dir: 'ltr'|'rtl'; width?: number;
  iYs?: number[]; oYs?: number[];
}> = ({ inputs, dir, width = 44, iYs, oYs }) => {
  const w = width;
  const color = 'rgba(59,130,246,0.35)';
  const x0   = dir === 'ltr' ? 0 : w;
  const x1   = dir === 'ltr' ? w : 0;
  const xbar = dir === 'ltr' ? Math.round(w * 0.72) : Math.round(w * 0.28);

  // Fall back to evenly-spaced defaults if not provided
  const inYs  = iYs ?? Array.from({length:inputs}, (_,i) => BH*(2*i+1)/(2*inputs));
  const outYs = oYs ?? (inputs===1 ? [BH/2] : Array.from({length:inputs/2}, (_,i) => BH*(2*i+1)/inputs));

  const paths: string[] = [];

  if (inputs === 1) {
    const inY  = inYs[0];
    const outY = outYs[0];
    if (Math.abs(inY - outY) < 2) {
      // Straight horizontal
      paths.push(`M${x0},${inY} H${x1}`);
    } else {
      // Step connector: horizontal → vertical → horizontal (handles CF→SCF going up)
      paths.push(`M${x0},${inY} H${xbar}`);
      paths.push(`M${xbar},${inY} V${outY}`);
      paths.push(`M${xbar},${outY} H${x1}`);
    }
  } else {
    for (let i = 0; i < inputs; i += 2) {
      const y1   = inYs[i];
      const y2   = inYs[i+1];
      const yOut = outYs[i/2];
      paths.push(`M${x0},${y1}    H${xbar}`);
      paths.push(`M${x0},${y2}    H${xbar}`);
      paths.push(`M${xbar},${y1}  V${y2}`);
      paths.push(`M${xbar},${yOut} H${x1}`);
    }
  }

  return (
    <svg width={w} height={BH}
      style={{flexShrink:0, display:'block', alignSelf:'stretch'}}>
      {paths.map((d,i) => (
        <path key={i} d={d} stroke={color} strokeWidth="1.5"
          fill="none" strokeLinecap="square" strokeLinejoin="miter"/>
      ))}
    </svg>
  );
};

// ─── Matchup card — waffle-dominant Athletic style ────────────────────────────
// The waffle IS the card. Sim-count numbers are overlaid in the corners of the
// grid. Team info lives in a compact strip beneath. No separate numbers section.

interface CardProps {
  hi: ST; lo: ST;
  isFinal?: boolean;
  onClickTeam: (t:string) => void;
}

const MatchupCard: React.FC<CardProps> = ({ hi, lo, isFinal=false, onClickTeam }) => {
  const [hov, setHov] = useState(false);
  const brk  = useMemo(() => seriesBreak(winProb(hi, lo)), [hi, lo]);
  const hC   = tc(hi.tricode);
  const lC   = tc(lo.tricode);

  // 10×10 = 100 cells; each cell = 1 sim win out of 100
  const cs   = isFinal ? 13 : 12;
  const gap  = 1;
  const cols = 10;
  const rows = 10;
  const tot  = cols * rows;
  const hN   = Math.round((brk.hw / 100) * tot);
  const segs: WafSeg[] = [{color:hC, count:hN}, {color:lC, count:tot-hN}];

  const hCount = Math.round(brk.hw);
  const lCount = Math.round(brk.lw);

  // Waffle fills full card width (no horizontal padding on the grid)
  const waffleW = cols * (cs + gap) - gap;   // 129px (normal) / 139px (final)
  const cardW   = waffleW + 2;               // 131 / 141px

  const logoSz  = isFinal ? 26 : 22;
  const hLabel  = seedLabel(hi);
  const lLabel  = seedLabel(lo);

  return (
    <div style={{width:cardW}} className="relative"
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>

      <div className="rounded-[2px] overflow-hidden bg-[#090b17]
                      shadow-[0_0_0_1px_rgba(59,130,246,0.5)]
                      hover:shadow-[0_0_0_1px_rgba(99,165,255,0.8)] transition-shadow duration-150">

        {/* ── Waffle fills edge-to-edge; numbers float in the corners ── */}
        <div className="relative">
          <WaffleGrid segs={segs} cols={cols} rows={rows} cs={cs} gap={gap} empty="#0d0f1e" />

          {/* Number overlay */}
          <div className="absolute inset-0 flex justify-between items-start
                          pointer-events-none select-none"
               style={{padding: '7px 8px 0'}}>
            <span className="font-black leading-none tabular-nums"
              style={{
                fontSize: isFinal ? 22 : 19,
                color: hC,
                textShadow: '0 1px 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)',
              }}>
              {hCount}
            </span>
            <span className="font-black leading-none tabular-nums"
              style={{
                fontSize: isFinal ? 22 : 19,
                color: lC,
                textShadow: '0 1px 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)',
              }}>
              {lCount}
            </span>
          </div>
        </div>

        {/* ── Team strip ── */}
        <div className="flex justify-between items-center px-2 pt-2 pb-2.5">

          {/* Hi team */}
          <button onClick={()=>onClickTeam(hi.tricode)}
            className="flex flex-col items-center gap-[3px] hover:opacity-70 transition-opacity">
            <Logo code={hi.tricode} size={logoSz} />
            <span className="text-[9px] font-black text-white/90 leading-none tracking-wide">
              {hi.tricode}
            </span>
            <span className="text-[7px] font-black leading-none px-1.5 py-[2px] rounded"
              style={{color:hC, background:`${hC}22`}}>
              {hLabel}
            </span>
          </button>

          <span className="text-[7px] text-white/15 font-mono pb-4">vs</span>

          {/* Lo team */}
          <button onClick={()=>onClickTeam(lo.tricode)}
            className="flex flex-col items-center gap-[3px] hover:opacity-70 transition-opacity">
            <Logo code={lo.tricode} size={logoSz} />
            <span className="text-[9px] font-black text-white/90 leading-none tracking-wide">
              {lo.tricode}
            </span>
            <span className="text-[7px] font-black leading-none px-1.5 py-[2px] rounded"
              style={{color:lC, background:`${lC}22`}}>
              {lLabel}
            </span>
          </button>

        </div>
      </div>

      {/* ── Hover tooltip ── */}
      {hov && (
        <div className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2
                        bg-[#070916]/96 backdrop-blur-xl
                        shadow-[0_0_0_1px_rgba(59,130,246,0.4)]
                        rounded-[2px] p-3 shadow-2xl pointer-events-none"
          style={{width:210}}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Logo code={hi.tricode} size={14}/>
              <span className="text-[9px] font-black text-white">{hi.tricode}</span>
            </div>
            <span className="text-[7px] text-white/20 uppercase tracking-wider">Series</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-black text-white">{lo.tricode}</span>
              <Logo code={lo.tricode} size={14}/>
            </div>
          </div>
          <div className="flex h-5 rounded-[1px] overflow-hidden mb-2">
            <div className="flex items-center justify-center text-[8px] font-black text-white/90"
              style={{width:`${brk.hw}%`, backgroundColor:hC}}>{brk.hw.toFixed(0)}%</div>
            <div className="flex items-center justify-center text-[8px] font-black text-white/90"
              style={{width:`${brk.lw}%`, backgroundColor:lC}}>{brk.lw.toFixed(0)}%</div>
          </div>
          {brk.bars.map(b=>(
            <div key={b.g} className="flex items-center gap-1 py-px">
              <span className="text-[8px] font-bold font-mono w-8 text-right" style={{color:hC}}>{b.h.toFixed(0)}%</span>
              <span className="text-[7px] text-white/20 font-mono flex-1 text-center">in {b.g}</span>
              <span className="text-[8px] font-bold font-mono w-8" style={{color:lC}}>{b.l.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Round column: fixed BH height, N slots ───────────────────────────────────
// Pass `centers` to pin each card to an exact Y (absolute mode).
// Without `centers`, slots are divided equally (legacy behaviour).
const RoundCol: React.FC<{
  slots: number; children: React.ReactNode[]; width: number;
  centers?: number[];
}> = ({ slots, children, width, centers }) => {
  if (centers) {
    return (
      <div style={{ height:BH, width, flexShrink:0, position:'relative' }}>
        {Array.from({length:slots}, (_,i) => (
          <div key={i} style={{
            position:'absolute', left:0, right:0,
            top: centers[i], transform:'translateY(-50%)',
            display:'flex', justifyContent:'center',
          }}>
            {children[i] ?? null}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ height:BH, width, flexShrink:0, display:'flex', flexDirection:'column' }}>
      {Array.from({length:slots}, (_,i) => (
        <div key={i} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          {children[i] ?? null}
        </div>
      ))}
    </div>
  );
};

// ─── Round header labels ───────────────────────────────────────────────────────
const RoundLabel = ({text, accent}: {text:string; accent?:string}) => (
  <div className="text-[7px] uppercase tracking-[0.28em] font-black text-center"
    style={{color: accent ?? 'rgba(255,255,255,0.18)'}}>
    {text}
  </div>
);

// ─── Division banner (shown in R1 above first matchup of each division) ───────
const DivBanner = ({name, color}: {name:string; color:string}) => (
  <div className="flex flex-col items-center gap-1">
    <div className="text-[8px] uppercase tracking-[0.35em] font-black"
      style={{color:`${color}90`}}>
      {name}
    </div>
    <div style={{width:48, height:1, background:`${color}30`}}/>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
interface PlayoffBracketProps {
  currentStandings: TeamStandings[];
  simResults: Record<string, SimResult>;
}

export default function PlayoffBracket({ currentStandings, simResults }: PlayoffBracketProps) {
  const [selTricode, setSelTricode] = useState<string|null>(null);

  const { west, east } = useMemo(() => {
    if (!currentStandings.length) return { west:[] as ST[], east:[] as ST[] };
    const e = currentStandings.filter(t => ['ATL','MET'].includes(DIV[t.tricode]??''));
    const w = currentStandings.filter(t => ['CEN','PAC'].includes(DIV[t.tricode]??''));
    return {
      west: seedConf(w,'CEN','PAC',simResults),
      east: seedConf(e,'ATL','MET',simResults),
    };
  }, [currentStandings, simResults]);

  const selData = useMemo(
    () => [...west,...east].find(t=>t.tricode===selTricode)??null,
    [west, east, selTricode],
  );

  if (!currentStandings.length || !Object.keys(simResults).length) {
    return (
      <div className="flex justify-center items-center py-32">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-rose-500"/>
      </div>
    );
  }

  const [w1,w2,w3,w4,w5,w6,w7,w8] = west;
  const [e1,e2,e3,e4,e5,e6,e7,e8] = east;

  if (!w1||!w2||!w3||!w4||!w5||!w6||!w7||!w8||
      !e1||!e2||!e3||!e4||!e5||!e6||!e7||!e8) {
    return <div className="text-center text-white/30 py-20 text-sm">Awaiting playoff field…</div>;
  }

  // ── Chalk projections ───────────────────────────────────────────────────────
  const wW1 = chalk(w1,w8); const wW2 = chalk(w2,w3);
  const wW3 = chalk(w4,w7); const wW4 = chalk(w5,w6);
  const wR2a = matchup(wW1, wW2);
  const wR2b = matchup(wW3, wW4);
  const wR2aW = chalk(wR2a.hi, wR2a.lo);
  const wR2bW = chalk(wR2b.hi, wR2b.lo);
  const wCF   = matchup(wR2aW, wR2bW);

  const eW1 = chalk(e1,e8); const eW2 = chalk(e2,e3);
  const eW3 = chalk(e4,e7); const eW4 = chalk(e5,e6);
  const eR2a = matchup(eW1, eW2);
  const eR2b = matchup(eW3, eW4);
  const eR2aW = chalk(eR2a.hi, eR2a.lo);
  const eR2bW = chalk(eR2b.hi, eR2b.lo);
  const eCF   = matchup(eR2aW, eR2bW);

  const wRep = chalk(wCF.hi, wCF.lo);
  const eRep = chalk(eCF.hi, eCF.lo);
  const scf  = matchup(wRep, eRep);

  const wD1 = DNAME[DIV[w1.tricode]??''] ?? 'Central';
  const wD2 = DNAME[DIV[w4.tricode]??''] ?? 'Pacific';
  const eD1 = DNAME[DIV[e1.tricode]??''] ?? 'Atlantic';
  const eD2 = DNAME[DIV[e4.tricode]??''] ?? 'Metropolitan';

  const W = '#f59e0b';    // West accent (amber)
  const E = '#38bdf8';    // East accent (sky)

  // Column widths — cards are 131px (normal) and 141px (final); cols add margin
  const R1W  = 135;
  const R2W  = 135;
  const CFW  = 135;
  const SCFW = 146;
  const CW   = 44;   // wider connector for right-angle bracket visibility

  const minW = R1W + CW + R2W + CW + CFW + CW + SCFW + CW + CFW + CW + R2W + CW + R1W;

  return (
    <div className="w-full select-none">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="text-center mb-6">
        <p className="text-[7px] uppercase tracking-[0.6em] text-white/20 font-black mb-1.5">
          Projected 2025–26
        </p>
        <h2 className="text-[28px] font-black text-white tracking-tight leading-none">
          Stanley Cup Bracket
        </h2>
        <p className="text-[8px] text-white/18 mt-1.5 font-mono">
          Chalk bracket · Grid squares = series wins per 100 sims · Hover for breakdown · Click team for full odds
        </p>
      </div>

      {/* ── Round labels ────────────────────────────────────────────────── */}
      <div className="flex justify-center items-center mb-3 gap-0" style={{minWidth:minW}}>
        <div style={{width:R1W}}><RoundLabel text="First Round"  accent={`${W}88`}/></div>
        <div style={{width:CW}}/>
        <div style={{width:R2W}}><RoundLabel text="Div. Final"/></div>
        <div style={{width:CW}}/>
        <div style={{width:CFW}}><RoundLabel text="Conf. Final"/></div>
        <div style={{width:CW}}/>
        <div style={{width:SCFW}}><RoundLabel text="Stanley Cup Final" accent="rgba(251,191,36,0.75)"/></div>
        <div style={{width:CW}}/>
        <div style={{width:CFW}}><RoundLabel text="Conf. Final"/></div>
        <div style={{width:CW}}/>
        <div style={{width:R2W}}><RoundLabel text="Div. Final"/></div>
        <div style={{width:CW}}/>
        <div style={{width:R1W}}><RoundLabel text="First Round"  accent={`${E}88`}/></div>
      </div>

      {/* ── Bracket ─────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto pb-6">
        <div className="flex items-stretch justify-center mx-auto" style={{minWidth:minW}}>

          {/* ══ West R1 ══ */}
          <RoundCol slots={4} width={R1W}>
            {[
              <div className="flex flex-col items-center gap-2" key="w1">
                <DivBanner name={wD1} color={W}/>
                <MatchupCard hi={w1} lo={w8} onClickTeam={setSelTricode}/>
              </div>,
              <MatchupCard key="w2" hi={w2} lo={w3} onClickTeam={setSelTricode}/>,
              <div className="flex flex-col items-center gap-2" key="w3">
                <DivBanner name={wD2} color={W}/>
                <MatchupCard hi={w4} lo={w7} onClickTeam={setSelTricode}/>
              </div>,
              <MatchupCard key="w4" hi={w5} lo={w6} onClickTeam={setSelTricode}/>,
            ]}
          </RoundCol>

          {/* R1→DivFinal: outYs from Figma (288/512, not default 200/600) */}
          <Conn inputs={4} dir="ltr" width={CW} oYs={[...DIV_Y]}/>

          {/* ══ West Div Finals ══ */}
          <RoundCol slots={2} width={R2W} centers={[...DIV_Y]}>
            {[
              <MatchupCard key="wr2a" hi={wR2a.hi} lo={wR2a.lo} onClickTeam={setSelTricode}/>,
              <MatchupCard key="wr2b" hi={wR2b.hi} lo={wR2b.lo} onClickTeam={setSelTricode}/>,
            ]}
          </RoundCol>

          {/* DivFinal→CF: iYs at 288/512, oY at CF_Y=400 */}
          <Conn inputs={2} dir="ltr" width={CW} iYs={[...DIV_Y]} oYs={[CF_Y]}/>

          {/* ══ West CF ══ */}
          <RoundCol slots={1} width={CFW} centers={[CF_Y]}>
            {[<MatchupCard key="wcf" hi={wCF.hi} lo={wCF.lo} onClickTeam={setSelTricode}/>]}
          </RoundCol>

          {/* CF→SCF: steps up from CF_Y=400 to SCF_Y=100 */}
          <Conn inputs={1} dir="ltr" width={CW} iYs={[CF_Y]} oYs={[SCF_Y]}/>

          {/* ══ Stanley Cup Final — top-aligned ══ */}
          <RoundCol slots={1} width={SCFW} centers={[SCF_Y]}>
            {[<MatchupCard key="scf" hi={scf.hi} lo={scf.lo} isFinal onClickTeam={setSelTricode}/>]}
          </RoundCol>

          {/* SCF→CF: steps down from SCF_Y=100 to CF_Y=400 */}
          <Conn inputs={1} dir="rtl" width={CW} iYs={[CF_Y]} oYs={[SCF_Y]}/>

          {/* ══ East CF ══ */}
          <RoundCol slots={1} width={CFW} centers={[CF_Y]}>
            {[<MatchupCard key="ecf" hi={eCF.hi} lo={eCF.lo} onClickTeam={setSelTricode}/>]}
          </RoundCol>

          {/* CF→DivFinal (East): iYs at CF_Y, oYs at 288/512 */}
          <Conn inputs={2} dir="rtl" width={CW} iYs={[...DIV_Y]} oYs={[CF_Y]}/>

          {/* ══ East Div Finals ══ */}
          <RoundCol slots={2} width={R2W} centers={[...DIV_Y]}>
            {[
              <MatchupCard key="er2a" hi={eR2a.hi} lo={eR2a.lo} onClickTeam={setSelTricode}/>,
              <MatchupCard key="er2b" hi={eR2b.hi} lo={eR2b.lo} onClickTeam={setSelTricode}/>,
            ]}
          </RoundCol>

          {/* DivFinal→R1 (East): iYs at 288/512, outYs default (200/600 even spacing) */}
          <Conn inputs={4} dir="rtl" width={CW} oYs={[...DIV_Y]}/>

          {/* ══ East R1 ══ */}
          <RoundCol slots={4} width={R1W}>
            {[
              <div className="flex flex-col items-center gap-2" key="e1">
                <DivBanner name={eD1} color={E}/>
                <MatchupCard hi={e1} lo={e8} onClickTeam={setSelTricode}/>
              </div>,
              <MatchupCard key="e2" hi={e2} lo={e3} onClickTeam={setSelTricode}/>,
              <div className="flex flex-col items-center gap-2" key="e3">
                <DivBanner name={eD2} color={E}/>
                <MatchupCard hi={e4} lo={e7} onClickTeam={setSelTricode}/>
              </div>,
              <MatchupCard key="e4" hi={e5} lo={e6} onClickTeam={setSelTricode}/>,
            ]}
          </RoundCol>

        </div>
      </div>

      {/* ── Conference badges ───────────────────────────────────────────── */}
      <div className="flex justify-center gap-3 mt-2">
        {[['Western Conference', W], ['Eastern Conference', E]].map(([n,c]) => (
          <div key={n} className="text-[7px] uppercase tracking-[0.35em] font-black px-3 py-1 rounded-full"
            style={{ color:`${c}55`, border:`1px solid ${c}18`, background:`${c}06` }}>
            {n}
          </div>
        ))}
      </div>

      <p className="text-center text-[7px] text-white/10 font-mono mt-2">
        Inner rounds show chalk-projected matchups · Cup odds used to seed projected brackets
      </p>

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
