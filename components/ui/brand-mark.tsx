import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * The compact pony xG mark for the app bar: the neon horse outline plus the
 * scoreboard-LED "pony xG" wordmark and its goal light, drawn as ~2 KB of
 * inline SVG (no fetch). On first paint the LED dots light up left to right
 * and the goal light flashes twice — CSS only, skipped under reduced motion.
 *
 * Decorative by default: give the surrounding link its accessible name.
 */

// Horse outline + eye from public/ponyxG_full.svg (SVGO, 1-decimal precision).
const HORSE =
  "m165.7 16.9-3.2 3.1a45 45 0 0 0-5.9 7.9 45 45 0 0 0-3.7 10c-1.2 5.9-2.9 8-7 8.8-1.6.3-1.9.2-2.9.8l-1.3.9c-9.3 6.4-18.9 8.3-25.4 14-13.9 12.1-17.9 41.3-36.8 74.1-13.2 22.8-28 18.5-41 26.6s-5.8-1.5-2-3.6c3.8-2 19.1-5.8 22-9.5l9.5-7.5s-1.6-7.7-5-11-11.1-4.9-11.1-4.9c-12.3-2.3-19.8-1.4-29.9-13.1-3-3.5-10-7.5-7-12.5 9 0 9.3 1 16.5-2.5 6.6-3.2 11.5-6 27-20.9C92 45.2 105.8 35.8 135.6 32c6.4-.9 11.2 3.7 11.9 2.5 3.9-7.5 5.1-18.4 12-20.5 3.9-1.2 7.6-9.3 9.5-8 2.4 1.7.5 2.5 1.3 8v7.5l1.2 8.1c6.2 0 14.8-1.1 19.7-5.6 7.6-7.1 11.8-6.5 12.3 0 0 8.2-3.3 10.9-7.5 17.8l-5.5 8.7L193 54c6.5 6.9 16.5 20.6 26.5 35 3.7 5.3 13.3 16.5 18 22.5 11.1 13.8 7.5 15.1 7.5 18.4-2.5 8.1-2.5 9.1-8.5 14.1-3.4 1.8-8 4-10 3.5-1-.2-3.5 0-7-3.5s-4.1-1.8-9-7.5c-3.1-3.6-8.7-5.4-11.5-6.6a144 144 0 0 0-24.8-7.4c-4.2-.7-8.6 10.2-10.2 14-.9 2.1-8 12.6-10 20s-7.1 9.1-5-1.1 15.2-28.8 17.5-33.4c1.3-2.5-6.6-2.1-12.5-5-12.4-5.9-15.5-6.5-18-21.5 0-4.9.7-15.1 4-16 2.4 0-1 7.1 0 15 2.1 16.6 11.1 19.5 30.1 23 11.8 2.2 26.1 6.2 32.8 9.1 4.1 1.8 7.5 4.5 12.6 9.9 6.9 7.3 7.1 7.5 11.9 7.5 4.4 0 5.3-.4 9.1-4.3 5.4-5.3 7.2-11 5.2-15.9-.8-1.9-3.9-6.3-6.9-9.8s-11.6-14.8-19-25-16-21.1-18.8-24.3a86 86 0 0 0-22.8-17.2 18 18 0 0 1-6.3-4.7 66 66 0 0 1-1.6-14zm16.4 16.2c-2.3.2-8.7 2.4-8.6 2.9.2.4 2.5 4.9 5.5 6.8l8.5 3.2 5.5-7c1.6-2.1 3-8.1 3-9.4 0-.2-2.2.4-4.9 1.4-2.7 1.1-6.7 2-9 2.1M128 36.9c-13 3-26.7 9.6-39 18.9a365 365 0 0 0-24 21.8A270 270 0 0 1 43.5 97a46 46 0 0 1-19.5 8h-3.4l4.3 4.4c7.6 7.7 18.3 7.2 29.7 12.6 3.7 1.7 6.2 2.1 9.4 4.6 4 3 8 9.9 8 9.9s15.5-27.1 21-49c2.5-9.9 18.1-28.1 25.5-33 5.7-3.8 22-12 24-12a25 25 0 0 0 5-3.5c.5-.9-11.6-3.9-19.5-2.1";
const EYE =
  "M188.2 71.8q1.7 1.7 1.8 3.2c0 2-3 5-5 5s-5-3-5-5 3-5 5-5c.8 0 2.3.8 3.2 1.8m48.3 51.5c4.8 4.7 4.6 8.9-.4 10.7-2 .6-9.1-6-9.1-8.7 0-1.7 3.6-5.3 5.4-5.3.4 0 2.3 1.4 4.1 3.3";

// LED grid: [column, row] cells for "pony xG" (row -1 = the G's top bar).
const DOTS: ReadonlyArray<readonly [number, number]> = [
  // p
  [0, 0],
  [1, 0],
  [0, 1],
  [2, 1],
  [0, 2],
  [2, 2],
  [0, 3],
  [1, 3],
  [0, 4],
  // o
  [5, 0],
  [4, 1],
  [6, 1],
  [4, 2],
  [6, 2],
  [5, 3],
  // n
  [8, 0],
  [9, 0],
  [8, 1],
  [10, 1],
  [8, 2],
  [10, 2],
  [8, 3],
  [10, 3],
  // y
  [12, 0],
  [14, 0],
  [12, 1],
  [14, 1],
  [12, 2],
  [14, 2],
  [13, 3],
  [12, 4],
  // x
  [19, 0],
  [21, 0],
  [20, 1],
  [20, 2],
  [19, 3],
  [21, 3],
  // G
  [23, -1],
  [24, -1],
  [25, -1],
  [23, 0],
  [23, 1],
  [25, 1],
  [23, 2],
  [25, 2],
  [23, 3],
  [24, 3],
];

const X0 = 264.3;
const Y0 = 106.8;
const PITCH = 11.66;
const CELL = 10;

export interface BrandMarkProps {
  className?: string;
  /** Run the one-time LED light-up (default true). */
  animate?: boolean;
  /** Accessible name; omit when the parent link is already named. */
  title?: string;
}

export function BrandMark({
  className,
  animate = true,
  title,
}: BrandMarkProps) {
  return (
    <svg
      viewBox="10 4 700 168"
      className={cn("h-8 w-auto overflow-visible", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <path d={HORSE} fill="#4FF5F7" />
      <path d={EYE} fill="#4FF5F7" />
      {/* Wordmark is scaled up 1.45× from the full logo so it stays legible at 32px */}
      <g transform="translate(259 160) scale(1.45) translate(-259 -160)">
        <g>
          {DOTS.map(([c, r], i) => (
            <rect
              key={i}
              x={X0 + c * PITCH - CELL / 2}
              y={Y0 + r * PITCH - CELL / 2}
              width={CELL}
              height={CELL}
              rx={1.8}
              fill="#F5F7FA"
              stroke="#0F9EA0"
              strokeWidth={1.6}
              style={
                animate
                  ? {
                      animation: `led-on 420ms ease-out ${120 + c * 26}ms both`,
                    }
                  : undefined
              }
            />
          ))}
        </g>
        {/* Goal light above the G */}
        <g transform="translate(544.1 77)">
          <circle
            r="16"
            fill="#FF2A2A"
            opacity="0.18"
            style={
              animate
                ? { animation: "goal-light 1.4s ease-in-out 1s 1 both" }
                : { opacity: 0.35 }
            }
          />
          <rect
            x="-6.5"
            y="-9"
            width="13"
            height="16"
            rx="3"
            fill="#1A1D24"
            stroke="#3A3F4A"
            strokeWidth="1.2"
          />
          <rect
            x="-4"
            y="-6.5"
            width="8"
            height="8.5"
            rx="2"
            fill="#FF3B3B"
            style={
              animate
                ? { animation: "goal-light 1.4s ease-in-out 1s 1 both" }
                : undefined
            }
          />
        </g>
      </g>
    </svg>
  );
}

export default BrandMark;
