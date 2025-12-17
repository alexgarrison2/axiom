'use client';

import React from 'react';
import Link from 'next/link';
import FullLogoAnimated from './FullLogoAnimated';

interface HeaderProps {
    lastRefresh?: string;
    compact?: boolean;
}

const Header: React.FC<HeaderProps> = ({ lastRefresh, compact = false }) => {
    return (
        <header className={`flex flex-col items-center justify-center ${compact ? 'mb-8 mt-4' : 'mb-12 mt-8'}`}>
            <Link href="/" className={`${compact ? 'w-[200px]' : 'w-full max-w-[340px] md:max-w-[600px]'} h-auto hover:opacity-90 transition-opacity`}>
                <FullLogoAnimated />
            </Link>



            {lastRefresh && (
                <div className="text-neutral-500 text-xs md:text-sm font-mono tracking-widest uppercase mt-4 opacity-80">
                    Last Refresh: {lastRefresh}
                </div>
            )}
        </header>
    );
};

export default Header;
