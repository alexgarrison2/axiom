import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import TeamSelector from '@/components/TeamSelector';
import { TeamInfo } from '@/types';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { usePlayoffsActive } from '@/hooks/usePlayoffsActive';

// Derive "Mar-06" style labels for today and tomorrow
function getNavDates(): { label: string; tab: string }[] {
    const toLocalIsoDate = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const fmt = (d: Date) => {
        const mon = d.toLocaleDateString('en-US', { month: 'short' });
        const day = String(d.getDate()).padStart(2, '0');
        const iso = toLocalIsoDate(d);
        return { label: `${mon}-${day}`, tab: iso };
    };
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return [fmt(today), fmt(tomorrow)];
}

const NAV_TABS = [
    { label: 'NEWS',     tab: 'News' },
    { label: 'TEAMS',    tab: 'Teams' },
    { label: 'HISTORY',  tab: 'History' },
    { label: 'BRACKET',  tab: 'Bracket' },
    { label: 'SKATERS',  tab: 'Skaters' },
];

gsap.registerPlugin(useGSAP, ScrollTrigger);

interface TeamHeaderProps {
    teamInfo: TeamInfo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allTeamsList: any[];
}

const TeamHeader: React.FC<TeamHeaderProps> = ({ teamInfo, allTeamsList }) => {
    const primaryColor = teamInfo.HexColor1;
    const playoffsActive = usePlayoffsActive();
    const bgRef = useRef<HTMLDivElement>(null);
    const navRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    const handleBack = () => {
        router.back();
    };

    useGSAP(() => {
        if (!bgRef.current) return;

        // Parallax Background
        gsap.to(bgRef.current, {
            yPercent: 30,
            ease: 'none',
            scrollTrigger: {
                trigger: document.body,
                start: 'top top',
                end: 'bottom top',
                scrub: true
            }
        });

        // Navbar blur intensity increase on scroll
        if (navRef.current) {
            gsap.to(navRef.current, {
                backgroundColor: 'rgba(0,0,0,0.95)',
                boxShadow: '0 4px 30px rgba(0,0,0,0.5)',
                scrollTrigger: {
                    trigger: document.body,
                    start: 'top top',
                    end: '100px top',
                    scrub: true
                }
            });
        }

    }, { scope: bgRef });

    return (
        <>
            {/* Ambient Background - Parallaxed */}
            <div
                ref={bgRef}
                className="fixed top-0 left-0 w-full h-[80vh] opacity-40 blur-[150px] pointer-events-none z-0"
                style={{ background: `radial-gradient(circle at 50% 0%, ${primaryColor}, transparent)` }}
            ></div>

            {/* Navbar */}
            <div
                ref={navRef}
                className="fixed top-0 left-0 right-0 z-40 bg-black/60 backdrop-blur-md border-b border-white/5 h-16 flex items-center transition-colors duration-300"
            >
                <div className="max-w-[1800px] mx-auto px-4 md:px-8 w-full flex items-center gap-4 md:gap-6">
                    {/* Back + Team selector */}
                    <div className="flex items-center gap-4 flex-shrink-0">
                        <button onClick={handleBack} className="group flex items-center gap-2 text-gray-500 hover:text-white transition-colors">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:-translate-x-1 transition-transform"><path d="m15 18-6-6 6-6" /></svg>
                            <span className="text-xs font-bold uppercase tracking-wider hidden sm:block">Back</span>
                        </button>
                        <div className="h-4 w-px bg-white/10"></div>
                        <TeamSelector teams={allTeamsList} currentTeam={teamInfo} />
                    </div>

                    {/* Divider */}
                    <div className="h-4 w-px bg-white/10 flex-shrink-0"></div>

                    {/* Logo → home */}
                    <Link href="/" className="flex-shrink-0 hover:opacity-70 transition-opacity">
                        <Image src="/ponyxG_condensed.png" alt="pony xG" width={80} height={24} priority className="h-4 md:h-5 w-auto object-contain drop-shadow-[0_0_8px_rgba(0,243,255,0.8)]" />
                    </Link>

                    {/* Nav tabs */}
                    <nav className="flex items-center gap-1 md:gap-2 overflow-x-auto scrollbar-hide flex-1">
                        {getNavDates().map(({ label, tab }) => (
                            <Link
                                key={tab}
                                href={`/?tab=${tab}`}
                                className="px-3 py-1.5 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider whitespace-nowrap text-gray-500 hover:text-white hover:bg-white/5 transition-all flex-shrink-0"
                            >
                                {label}
                            </Link>
                        ))}
                        {NAV_TABS.map(({ label, tab }) => (
                            <Link
                                key={tab}
                                href={`/?tab=${tab}`}
                                className="px-3 py-1.5 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider whitespace-nowrap text-gray-500 hover:text-white hover:bg-white/5 transition-all flex-shrink-0"
                            >
                                {label}
                            </Link>
                        ))}
                        {playoffsActive && (
                            <Link
                                href="/playoffs"
                                className="px-3 py-1.5 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider whitespace-nowrap text-gray-500 hover:text-white hover:bg-white/5 transition-all flex-shrink-0"
                            >
                                PLAYOFFS
                            </Link>
                        )}
                    </nav>
                </div>
            </div>

            {/* Padding for fixed navbar */}
            <div className="pt-24"></div>
        </>
    );
};

export default TeamHeader;
