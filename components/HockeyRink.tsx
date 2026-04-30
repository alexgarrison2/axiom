'use client';

/**
 * HockeyRink.tsx — full-rink shot map component
 *
 * Coordinate system (matches NHL PBP / shots CSV):
 *   x: feet from center ice, -100 → left goal line -89, 100 → right goal line 89
 *   y: feet from rink centerline, -42.5 → far boards, 42.5 → near boards
 *
 * Props:
 *   shots        – array of shot events to render
 *   homeTriCode  – home team abbreviation (drives right-side label + logo)
 *   awayTriCode  – away team abbreviation (drives left-side label + logo)
 *   homeColor    – CSS color string for home shot dots
 *   awayColor    – CSS color string for away shot dots
 *   id           – unique string for SVG filter/pattern IDs (avoids collision on multi-rink pages)
 *   onShotHover  – callback when a dot is hovered, receives shot or null
 */

import React, { useId } from 'react';

export interface RinkShot {
  eventId: string | number;
  playerId: string | number;
  teamTriCode: string;
  x: number;         // feet, centered on rink (attacking direction already resolved by caller)
  y: number;         // feet, centered on rink width
  xG: number;        // 0–1
  isGoal: boolean;
  eventType?: string;
  playerName?: string;
  strength?: string;
  distance?: number;
  angle?: number;
  period?: number;
  timeSeconds?: number;
}

interface HockeyRinkProps {
  shots?: RinkShot[];
  homeTriCode?: string;
  awayTriCode?: string;
  homeColor?: string;
  awayColor?: string;
  id?: string;
  onShotHover?: (shot: RinkShot | null) => void;
  className?: string;
}

// Rink dimensions in feet
const RINK_W = 200;
const RINK_H = 85;
// SVG canvas size
const W = 1000;
const H = 425;
// Scale: 5 px per foot (1000/200 = 5)
const SCALE = W / RINK_W;

/** Convert rink feet → SVG px */
const sx = (x: number) => (x + RINK_W / 2) * SCALE;
const sy = (y: number) => (RINK_H / 2 - y) * SCALE;

/** Corner radius in px (28 ft NHL) */
const CORNER_R = 28 * SCALE;

/** Rounded-rectangle clip path for rink outline */
const rinkPath = `
  M ${sx(-RINK_W / 2 + 28)} ${sy(RINK_H / 2)}
  H ${sx(RINK_W / 2 - 28)}
  Q ${sx(RINK_W / 2)} ${sy(RINK_H / 2)} ${sx(RINK_W / 2)} ${sy(RINK_H / 2 - 28)}
  V ${sy(-(RINK_H / 2 - 28))}
  Q ${sx(RINK_W / 2)} ${sy(-RINK_H / 2)} ${sx(RINK_W / 2 - 28)} ${sy(-RINK_H / 2)}
  H ${sx(-RINK_W / 2 + 28)}
  Q ${sx(-RINK_W / 2)} ${sy(-RINK_H / 2)} ${sx(-RINK_W / 2)} ${sy(-(RINK_H / 2 - 28))}
  V ${sy(RINK_H / 2 - 28)}
  Q ${sx(-RINK_W / 2)} ${sy(RINK_H / 2)} ${sx(-RINK_W / 2 + 28)} ${sy(RINK_H / 2)}
  Z
`;

function FaceoffDot({ cx, cy, stroke = '#dc2626' }: { cx: number; cy: number; stroke?: string }) {
  const px = sx(cx);
  const py = sy(cy);
  const arm = 18;
  const gap = 4;
  return (
    <g>
      <circle cx={px} cy={py} r="3.8" fill={stroke} />
      <path
        d={`M ${px - arm} ${py} H ${px - gap} M ${px + gap} ${py} H ${px + arm}
            M ${px} ${py - arm} V ${py - gap} M ${px} ${py + gap} V ${py + arm}`}
        stroke={stroke}
        strokeWidth="1.2"
        fill="none"
      />
    </g>
  );
}

function FaceoffCircle({ cx, cy, stroke = '#dc2626' }: { cx: number; cy: number; stroke?: string }) {
  const px = sx(cx);
  const py = sy(cy);
  const r = 15 * SCALE; // 15 ft radius
  // Hash marks at ±9 ft vertical, ±14 ft horizontal from circle tangent
  const hOff = 9 * SCALE;
  const hLen = 14 * SCALE;
  const vOff = 9 * SCALE;
  const vLen = 14 * SCALE;
  return (
    <g>
      <circle cx={px} cy={py} r={r} fill="none" stroke={stroke} strokeWidth="1.45" />
      {/* Hash marks — four corners */}
      <path
        d={`
          M ${px - r} ${py - hOff} h ${-hLen}
          M ${px - r} ${py + hOff} h ${-hLen}
          M ${px + r - hLen} ${py - hOff} h ${hLen}
          M ${px + r - hLen} ${py + hOff} h ${hLen}
          M ${px - vOff} ${py - r} v ${-vLen}
          M ${px + vOff} ${py - r} v ${-vLen}
          M ${px - vOff} ${py + r - vLen} v ${vLen}
          M ${px + vOff} ${py + r - vLen} v ${vLen}
        `}
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinecap="square"
        fill="none"
      />
      <FaceoffDot cx={cx} cy={cy} stroke={stroke} />
    </g>
  );
}

function GoalCrease({ side }: { side: 'left' | 'right' }) {
  const goalX = side === 'left' ? -89 : 89;
  const dir = side === 'left' ? 1 : -1; // direction inward from goal line

  const glX = sx(goalX);
  const cY = sy(0);

  // Posts at ±3 ft from centerline
  const postTop = sy(3);
  const postBot = sy(-3);

  // Crease: 8 ft deep, 8 ft wide (±4 ft sides extend to ±6 ft shoulder)
  const creaseDepth = 8;
  const creaseHalfW = 4;
  const creaseSweep = 7; // bezier control depth for the rounded front

  const creaseInnerX = sx(goalX + dir * creaseDepth);
  const creaseSweepX = sx(goalX + dir * (creaseDepth + creaseSweep));
  const creaseTopY = sy(creaseHalfW);
  const cBotY = sy(-creaseHalfW);

  // Shoulder of crease (wider part)
  const shoulderX = sx(goalX + dir * 4.2);

  // Goal net (6 ft deep behind goal line)
  const netDepth = 6;
  const netBackX = sx(goalX - dir * netDepth);

  // Trapezoid (NHL 2005): 11 ft from post at goal line, 22 ft from post at boards
  const trapGoalLineY = 11 * SCALE;
  const trapBoardY = 22 * SCALE;
  const boardY = sy(-42.5);
  const boardY2 = sy(42.5);

  return (
    <g>
      {/* Crease fill */}
      <path
        d={`M ${glX} ${creaseTopY}
            L ${shoulderX} ${creaseTopY}
            C ${creaseSweepX} ${creaseTopY}, ${creaseSweepX} ${cBotY}, ${shoulderX} ${cBotY}
            L ${glX} ${cBotY}
            Z`}
        fill="#7ec8f5"
        fillOpacity="0.35"
        stroke="#1d6bbf"
        strokeWidth="1.8"
      />
      {/* Goal line portion inside crease */}
      <line x1={glX} y1={creaseTopY} x2={glX} y2={cBotY} stroke="#1d6bbf" strokeWidth="1.2" opacity="0.7" />

      {/* Trapezoid lines */}
      <line
        x1={glX} y1={cY - trapGoalLineY}
        x2={glX + dir * -80} y2={cY - trapBoardY}
        stroke="#1d6bbf" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.6"
      />
      <line
        x1={glX} y1={cY + trapGoalLineY}
        x2={glX + dir * -80} y2={cY + trapBoardY}
        stroke="#1d6bbf" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.6"
      />

      {/* Net */}
      <path
        d={`M ${glX} ${postTop}
            L ${netBackX} ${postTop + 9}
            M ${glX} ${postBot}
            L ${netBackX} ${postBot - 9}
            M ${netBackX} ${postTop + 9}
            C ${netBackX - dir * 4} ${cY - 7}, ${netBackX - dir * 4} ${cY + 7}, ${netBackX} ${postBot - 9}`}
        fill="none"
        stroke="#c81e2c"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Net interior lines */}
      <path
        d={`M ${glX} ${postTop} L ${netBackX} ${postTop + 9}
            M ${glX} ${cY} L ${netBackX - dir * 3} ${cY}
            M ${glX} ${postBot} L ${netBackX} ${postBot - 9}`}
        stroke="#dbe3ea"
        strokeWidth="0.9"
        opacity="0.6"
        fill="none"
      />
      {/* Goal posts (pipes) */}
      <line x1={glX} y1={postTop} x2={glX} y2={postBot} stroke="#c81e2c" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx={glX} cy={postTop} r="3.4" fill="#c81e2c" />
      <circle cx={glX} cy={postBot} r="3.4" fill="#c81e2c" />
      {/* Front of crease dot */}
      <circle cx={creaseInnerX} cy={cY} r="2.2" fill="#c81e2c" opacity="0.7" />
    </g>
  );
}

function RefereeCrease() {
  // 10 ft radius semicircle at center ice, facing left (toward benches)
  const r = 10 * SCALE;
  const cx = sx(0);
  const cy = sy(0);
  return (
    <path
      d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r}`}
      fill="none"
      stroke="#1d6bbf"
      strokeWidth="1.2"
      opacity="0.5"
    />
  );
}

export default function HockeyRink({
  shots = [],
  homeTriCode,
  awayTriCode,
  homeColor = '#22c55e',
  awayColor = '#3b82f6',
  id,
  onShotHover,
  className = '',
}: HockeyRinkProps) {
  const reactId = useId();
  const uid = (id ?? reactId).replace(/[^a-zA-Z0-9_-]/g, '_');

  const colorFor = (tri: string) =>
    tri === homeTriCode ? homeColor : awayColor;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full ${className}`}
      role="img"
      aria-label="Hockey rink shot map"
    >
      <defs>
        {/* Ice surface base gradient */}
        <radialGradient id={`ice-${uid}`} cx="50%" cy="46%" r="78%">
          <stop offset="0%"   stopColor="#fafcff" />
          <stop offset="40%"  stopColor="#eef5fb" />
          <stop offset="100%" stopColor="#d4e4f0" />
        </radialGradient>

        {/* Edge vignette */}
        <radialGradient id={`vignette-${uid}`} cx="50%" cy="50%" r="68%">
          <stop offset="55%"  stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#8fafc8" stopOpacity="0.22" />
        </radialGradient>

        {/* Rink outline clip */}
        <clipPath id={`clip-${uid}`}>
          <path d={rinkPath} />
        </clipPath>
      </defs>

      {/* ── Ice surface ── */}
      <g clipPath={`url(#clip-${uid})`}>
        {/* Base ice colour */}
        <rect x="0" y="0" width={W} height={H} fill={`url(#ice-${uid})`} />
        {/* Real NHL ice texture overlaid via multiply — adds grain without darkening */}
        <image
          href="/images/nhl_ice_surface.png"
          x="0" y="0"
          width={W} height={H}
          preserveAspectRatio="xMidYMid slice"
          opacity="0.55"
          style={{ mixBlendMode: 'multiply' } as React.CSSProperties}
        />
        {/* Edge vignette */}
        <rect x="0" y="0" width={W} height={H} fill={`url(#vignette-${uid})`} />

        {/* ── Lines ── */}
        {/* Center red line (dashed) */}
        <line x1={sx(0)} x2={sx(0)} y1="0" y2={H} stroke="#c8212f" strokeWidth="4.5" strokeDasharray="14 9" />
        {/* Blue lines */}
        <line x1={sx(-25)} x2={sx(-25)} y1="0" y2={H} stroke="#1f5fbf" strokeWidth="5" />
        <line x1={sx(25)}  x2={sx(25)}  y1="0" y2={H} stroke="#1f5fbf" strokeWidth="5" />
        {/* Goal lines */}
        <line x1={sx(-89)} x2={sx(-89)} y1="0" y2={H} stroke="#d6313b" strokeWidth="2" />
        <line x1={sx(89)}  x2={sx(89)}  y1="0" y2={H} stroke="#d6313b" strokeWidth="2" />

        {/* ── Center ice ── */}
        {/* Center circle (15 ft radius) */}
        <circle cx={sx(0)} cy={sy(0)} r={15 * SCALE} fill="none" stroke="#1d6bbf" strokeWidth="1.5" />
        {/* Referee crease (right side of center line) */}
        <RefereeCrease />
        {/* Center dot */}
        <FaceoffDot cx={0} cy={0} stroke="#1d6bbf" />

        {/* ── Neutral zone dots ── */}
        <FaceoffDot cx={-20} cy={-22} />
        <FaceoffDot cx={-20} cy={22} />
        <FaceoffDot cx={20}  cy={-22} />
        <FaceoffDot cx={20}  cy={22} />

        {/* ── Zone faceoff circles ── */}
        {([ [-69, -22], [-69, 22], [69, -22], [69, 22] ] as [number, number][]).map(([x, y]) => (
          <FaceoffCircle key={`${x}-${y}`} cx={x} cy={y} />
        ))}

        {/* ── Creases + nets + trapezoids ── */}
        <GoalCrease side="left" />
        <GoalCrease side="right" />

        {/* ── Rink border ── */}
        <path d={rinkPath} fill="none" stroke="#c8d6e0" strokeWidth="6"   opacity="0.5" />
        <path d={rinkPath} fill="none" stroke="#8fa8bc" strokeWidth="1.2" opacity="0.6" />

        {/* ── Team labels — centered in each attacking zone ── */}
        {homeTriCode && (
          <text
            x={sx(57)}
            y={sy(0) + 10}
            transform={`rotate(90 ${sx(57)} ${sy(0)})`}
            fill="#1a2d3f"
            fontSize="26"
            fontWeight="900"
            fontFamily="'Barlow Semi Condensed', sans-serif"
            textAnchor="middle"
            opacity="0.5"
            letterSpacing="0.06em"
          >
            {homeTriCode}
          </text>
        )}
        {awayTriCode && (
          <text
            x={sx(-57)}
            y={sy(0) + 10}
            transform={`rotate(-90 ${sx(-57)} ${sy(0)})`}
            fill="#1a2d3f"
            fontSize="26"
            fontWeight="900"
            fontFamily="'Barlow Semi Condensed', sans-serif"
            textAnchor="middle"
            opacity="0.5"
            letterSpacing="0.06em"
          >
            {awayTriCode}
          </text>
        )}

        {/* ── Center ice logo ── */}
        {homeTriCode && (
          <image
            href={`/logos/${homeTriCode}.svg`}
            x={sx(0) - 40}
            y={sy(0) - 40}
            width="80"
            height="80"
            opacity="0.22"
          />
        )}
      </g>

      {/* ── Shot dots (rendered outside clip so labels can overflow) ── */}
      {shots.map(s => {
        const r = Math.max(4, Math.min(18, 5 + s.xG * 42));
        const cx = sx(s.x);
        const cy = sy(s.y);
        const fill = colorFor(s.teamTriCode);
        return (
          <g
            key={`${s.eventId}-${s.playerId}`}
            onMouseEnter={() => onShotHover?.(s)}
            onMouseLeave={() => onShotHover?.(null)}
            className="cursor-crosshair"
          >
            {s.isGoal && (
              <circle
                cx={cx} cy={cy}
                r={r + 8}
                fill="none"
                stroke="#facc15"
                strokeWidth="3.5"
                opacity="0.9"
              />
            )}
            <circle
              cx={cx} cy={cy}
              r={r}
              fill={fill}
              fillOpacity={s.isGoal ? 1 : 0.75}
              stroke="#04111e"
              strokeWidth="1.5"
            />
          </g>
        );
      })}
    </svg>
  );
}
