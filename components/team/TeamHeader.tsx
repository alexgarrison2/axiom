import React from 'react';
import Link from 'next/link';
import TeamSelector from '@/components/TeamSelector';
import { TeamInfo } from '@/types';

interface TeamHeaderProps {
    teamInfo: TeamInfo;
    allTeamsList: any[]; // Using any[] for now as per original, can optimize strict type later
}

const TeamHeader: React.FC<TeamHeaderProps> = ({ teamInfo, allTeamsList }) => {
    const primaryColor = teamInfo.HexColor1;

    return (
        <>
            {/* Ambient Background */}
            <div
                className="fixed top-0 left-0 w-full h-[500px] opacity-40 blur-[150px] pointer-events-none z-0"
                style={{ background: `radial-gradient(circle at 50% 0%, ${primaryColor}, transparent)` }}
            ></div>

            {/* Navbar / Breadcrumbs Area */}
            <div className="fixed top-0 left-0 right-0 z-40 bg-black/80 backdrop-blur-xl border-b border-white/5 h-16 flex items-center">
                <div className="max-w-[1800px] mx-auto px-4 md:px-8 w-full flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <Link href="/" className="group flex items-center gap-2 text-gray-500 hover:text-white transition-colors">
                            <span className="text-xs font-bold uppercase tracking-wider block">Home</span>
                        </Link>
                        <div className="h-6 w-px bg-white/10"></div>
                        <TeamSelector teams={allTeamsList} currentTeam={teamInfo} />
                    </div>
                </div>
            </div>

            {/* Padding for fixed navbar */}
            <div className="pt-20"></div>
        </>
    );
};

export default TeamHeader;
