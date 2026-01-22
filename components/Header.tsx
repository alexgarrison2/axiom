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

    return (
        <header ref={headerRef} className={`relative z-0 flex flex-col items-center justify-center ${compact ? 'mb-8 mt-4' : 'mb-12 mt-16'}`}>
            <Link href="/" className={`${compact ? 'w-[200px]' : 'w-full max-w-[340px] md:max-w-[600px]'} h-auto hover:opacity-90 transition-opacity`} ref={logoRef}>
                <FullLogoAnimated />
            </Link>

            {lastRefresh && (
                <div ref={refreshRef} className="text-neutral-500 text-xs md:text-sm font-mono tracking-widest uppercase mt-4 opacity-80">
                    Last Refresh: {lastRefresh}
                </div>
            )}
        </header>
    );
};

export default Header;
