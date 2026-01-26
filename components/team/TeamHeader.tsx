import React, { useRef } from 'react';
import Link from 'next/link';
import TeamSelector from '@/components/TeamSelector';
import { TeamInfo } from '@/types';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

interface TeamHeaderProps {
    teamInfo: TeamInfo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allTeamsList: any[];
}

const TeamHeader: React.FC<TeamHeaderProps> = ({ teamInfo, allTeamsList }) => {
    const primaryColor = teamInfo.HexColor1;
    const bgRef = useRef<HTMLDivElement>(null);
    const navRef = useRef<HTMLDivElement>(null);

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

            {/* Navbar / Breadcrumbs Area */}
            <div
                ref={navRef}
                className="fixed top-0 left-0 right-0 z-40 bg-black/60 backdrop-blur-md border-b border-white/5 h-16 flex items-center transition-colors duration-300"
            >
                <div className="max-w-[1800px] mx-auto px-4 md:px-8 w-full flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <Link href="/" className="group flex items-center gap-2 text-gray-500 hover:text-white transition-colors">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:-translate-x-1 transition-transform"><path d="m15 18-6-6 6-6" /></svg>
                            <span className="text-xs font-bold uppercase tracking-wider block">Home</span>
                        </Link>
                        <div className="h-4 w-px bg-white/10"></div>
                        <TeamSelector teams={allTeamsList} currentTeam={teamInfo} />
                    </div>
                </div>
            </div>

            {/* Padding for fixed navbar */}
            <div className="pt-24"></div>
        </>
    );
};

export default TeamHeader;
