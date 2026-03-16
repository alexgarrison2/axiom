'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import FullLogoAnimated from './FullLogoAnimated';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

interface HeaderProps {
    lastRefresh?: string;
    compact?: boolean;
}

const Header: React.FC<HeaderProps> = ({ lastRefresh, compact = false }) => {
    const headerRef = useRef<HTMLHeadElement>(null);
    const logoRef = useRef<HTMLAnchorElement>(null);
    const refreshRef = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        if (!headerRef.current || !logoRef.current) return;

        // Skip animation if compact mode (Team Page)
        if (compact) return;

        // Create a timeline that is scrubbed by scroll
        const tl = gsap.timeline({
            scrollTrigger: {
                trigger: document.body,
                start: 'top top',
                end: '300px top',
                scrub: 1,
            }
        });

        tl.to(headerRef.current, {
            y: 100, // Parallax down slower than scroll
            ease: 'none',
        }, 0)
            .to(logoRef.current, {
                scale: 0.8,
                filter: 'blur(5px)',
                opacity: 0.4,
                ease: 'power1.out'
            }, 0)
            .to(refreshRef.current, {
                opacity: 0,
                y: -20,
            }, 0);

    }, { scope: headerRef, dependencies: [compact] });

    // --- Data Freshness Logic ---
    const getFreshness = (refreshStr: string) => {
        try {
            const refreshDate = new Date(refreshStr);
            if (isNaN(refreshDate.getTime())) return null;

            const now = new Date();
            const diffMs = now.getTime() - refreshDate.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            let relativeTime: string;
            if (diffMins < 1) relativeTime = 'just now';
            else if (diffMins < 60) relativeTime = `${diffMins}m ago`;
            else if (diffHours < 24) relativeTime = `${diffHours}h ago`;
            else relativeTime = `${diffDays}d ago`;

            let colorClass: string;
            let glowClass: string;
            if (diffHours < 1) {
                colorClass = 'text-emerald-400';
                glowClass = 'bg-emerald-400';
            } else if (diffHours < 6) {
                colorClass = 'text-amber-400';
                glowClass = 'bg-amber-400';
            } else {
                colorClass = 'text-red-400';
                glowClass = 'bg-red-400';
            }

            return { relativeTime, colorClass, glowClass, fullDate: refreshStr };
        } catch {
            return null;
        }
    };

    const freshness = lastRefresh ? getFreshness(lastRefresh) : null;

    return (
        <header ref={headerRef} className={`relative z-0 flex flex-col items-center justify-center ${compact ? 'mb-3 mt-2' : 'mb-6 mt-6'}`}>
            <Link href="/" className={`${compact ? 'w-[200px]' : 'w-full max-w-[340px] md:max-w-[600px]'} h-auto hover:opacity-90 transition-opacity`} ref={logoRef}>
                <FullLogoAnimated />
            </Link>

            {lastRefresh && (
                <div ref={refreshRef} className="mt-2 opacity-80" title={lastRefresh}>
                    {freshness ? (
                        <div className="flex items-center gap-2 text-xs md:text-sm font-mono tracking-widest uppercase">
                            <span className="relative flex h-2 w-2">
                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${freshness.glowClass} opacity-75`}></span>
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${freshness.glowClass}`}></span>
                            </span>
                            <span className={freshness.colorClass}>
                                Updated {freshness.relativeTime}
                            </span>
                        </div>
                    ) : (
                        <span className="text-neutral-500 text-xs md:text-sm font-mono tracking-widest uppercase">
                            Last Refresh: {lastRefresh}
                        </span>
                    )}
                </div>
            )}
        </header>
    );
};

export default Header;
