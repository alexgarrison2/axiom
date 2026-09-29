'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePlayoffsActive } from '@/hooks/usePlayoffsActive';

interface NavBarProps {
  activePage: 'playoffs' | 'bracket' | 'teams' | 'history' | 'news' | 'skaters' | string;
  dates?: string[];
}

const NAV_ITEMS = [
  { key: 'news',     label: 'NEWS',     href: '/?tab=News',    color: 'text-amber-400 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.3)]',  bg: 'bg-amber-400/10' },
  { key: 'teams',    label: 'TEAMS',    href: '/?tab=Teams',   color: 'text-purple-400 border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.3)]', bg: 'bg-purple-400/10' },
  { key: 'history',  label: 'HISTORY',  href: '/?tab=History', color: 'text-neon-green border-neon-green shadow-[0_0_20px_rgba(10,255,0,0.3)]',    bg: 'bg-neon-green/10' },
  { key: 'playoffs', label: 'PLAYOFFS', href: '/playoffs',     color: 'text-rose-400 border-rose-400 shadow-[0_0_20px_rgba(251,113,133,0.3)]',     bg: 'bg-rose-400/10' },
  { key: 'bracket',  label: 'BRACKET',  href: '/?tab=Bracket', color: 'text-sky-400 border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.3)]',        bg: 'bg-sky-400/10' },
  { key: 'skaters',  label: 'SKATERS',  href: '/?tab=Skaters', color: 'text-cyan-400 border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.3)]',      bg: 'bg-cyan-400/10' },
];

export default function NavBar({ activePage, dates = [] }: NavBarProps) {
  const playoffsActive = usePlayoffsActive();
  return (
    <div className="flex flex-col items-center gap-3 relative z-20 mb-3 mt-2">
      <div className="relative w-full px-3 md:px-0">
        <div className="flex items-center gap-1 md:gap-2 bg-black/40 p-1 md:p-1.5 rounded-xl md:rounded-2xl backdrop-blur-md border border-white/5 w-full overflow-x-auto snap-x scrollbar-hide px-1.5 md:px-3">

          {/* Logo */}
          <div className="flex-shrink-0 flex items-center pr-2 md:pr-3 border-r border-white/10 mr-1 snap-start">
            <Link href="/">
              <Image src="/ponyxG_condensed.png" alt="pony xG" width={80} height={24} className="h-4 md:h-5 w-auto object-contain drop-shadow-[0_0_8px_rgba(0,243,255,0.8)] hover:opacity-70 transition-opacity" />
            </Link>
          </div>

          {/* Date tabs */}
          {dates.map(date => {
            const [, m, d] = date.split('-').map(Number);
            const monthShort = new Date(2000, m - 1, d).toLocaleDateString('en-US', { month: 'short' });
            const label = `${monthShort}-${String(d).padStart(2, '0')}`;
            return (
              <Link
                key={date}
                href={`/?tab=${date}`}
                className="relative px-3 md:px-4 py-1.5 rounded-full font-bold text-[10px] md:text-xs tracking-wider transition-all duration-300 border flex-shrink-0 snap-start whitespace-nowrap bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5"
              >
                {label}
              </Link>
            );
          })}

          {/* Nav items */}
          {NAV_ITEMS.filter(item => item.key !== 'playoffs' || playoffsActive || activePage === 'playoffs').map(item => {
            const isActive = activePage === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`relative px-3 md:px-4 py-1.5 rounded-full font-bold text-[10px] md:text-xs tracking-wider transition-all duration-300 border flex-shrink-0 snap-start ${
                  isActive
                    ? `${item.color}`
                    : 'bg-transparent text-gray-500 border-transparent hover:text-white hover:bg-white/5'
                }`}
              >
                {isActive && (
                  <span className={`absolute inset-0 rounded-full ${item.bg}`} />
                )}
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
