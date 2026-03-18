"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import LogoDisplay from './LogoDisplay';
import { OddsEntry } from '@/app/api/odds-history/route';

interface Team {
    triCode: string;
    name: string;
    logoUrl: string;
    color1: string;
}

interface OddsHistoryModalProps {
    gameId: string;
    date: string;
    awayTeam: Team;
    homeTeam: Team;
}

// Small trend-line icon trigger
function TrendIcon() {
    return (
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="inline-block">
            <polyline points="0,8 3,4 6,6 9,2 13,1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function Arrow({ dir }: { dir: 'up' | 'down' | null }) {
    if (!dir) return null;
    if (dir === 'up') return (
        <svg width="8" height="8" viewBox="0 0 8 8" className="inline-block mr-0.5 flex-shrink-0">
            <polyline points="1,6 4,2 7,6" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
    return (
        <svg width="8" height="8" viewBox="0 0 8 8" className="inline-block mr-0.5 flex-shrink-0">
            <polyline points="1,2 4,6 7,2" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export default function OddsHistoryModal({ gameId, date, awayTeam, homeTeam }: OddsHistoryModalProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [entries, setEntries] = useState<OddsEntry[]>([]);

    const fetchHistory = useCallback(async () => {
        if (entries.length > 0) return; // already loaded
        setLoading(true);
        try {
            const res = await fetch(`/api/odds-history?gameId=${encodeURIComponent(gameId)}&date=${date}`);
            const data = await res.json();
            setEntries(data.entries ?? []);
        } catch {
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [gameId, date, entries.length]);

    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(true);
        fetchHistory();
    };

    const handleClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        setOpen(false);
    };

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    const trigger = (
        <button
            onClick={handleOpen}
            title="Odds history"
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold text-neutral-400 hover:text-white hover:bg-white/10 transition-colors border border-transparent hover:border-white/10"
        >
            <TrendIcon />
            <span className="text-[9px] uppercase tracking-widest">History</span>
        </button>
    );

    if (!open || typeof document === 'undefined') return trigger;

    const modal = createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            onClick={handleClose}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

            {/* Panel */}
            <div
                className="relative z-10 bg-[#111] border border-white/10 rounded-2xl shadow-2xl max-w-[95vw] overflow-hidden"
                onClick={e => e.stopPropagation()}
                style={{ minWidth: 320 }}
            >
                {/* Close */}
                <button
                    onClick={handleClose}
                    className="absolute top-3 right-3 text-neutral-500 hover:text-white transition-colors z-10"
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </button>

                <div className="px-5 pt-4 pb-1">
                    <span className="text-[9px] font-black uppercase tracking-widest text-neutral-500">Odds Movement</span>
                </div>

                {loading && (
                    <div className="px-5 py-6 text-center text-neutral-500 text-xs">Loading…</div>
                )}

                {!loading && entries.length === 0 && (
                    <div className="px-5 py-6 text-center text-neutral-500 text-xs">No odds history for today</div>
                )}

                {!loading && entries.length > 0 && (
                    <div className="px-3 pb-4 pt-2 overflow-x-auto">
                        {/* Away row */}
                        <TeamOddsRow team={awayTeam} entries={entries} field="awayOdds" dirField="awayDir" />
                        {/* Divider */}
                        <div className="h-px bg-white/5 my-2 mx-2" />
                        {/* Home row */}
                        <TeamOddsRow team={homeTeam} entries={entries} field="homeOdds" dirField="homeDir" />
                    </div>
                )}
            </div>
        </div>,
        document.body
    );

    return (
        <>
            {trigger}
            {modal}
        </>
    );
}

interface TeamOddsRowProps {
    team: Team;
    entries: OddsEntry[];
    field: 'awayOdds' | 'homeOdds';
    dirField: 'awayDir' | 'homeDir';
}

function fmt12(ts: string): string {
    // "14:30" → "2:30p", "09:17" → "9:17a"
    const [hStr, mStr] = ts.split(':');
    const h = parseInt(hStr, 10);
    const suffix = h < 12 ? 'a' : 'p';
    const h12 = h % 12 || 12;
    return `${h12}:${mStr}${suffix}`;
}

function TeamOddsRow({ team, entries, field, dirField }: TeamOddsRowProps) {
    const lastIdx = entries.length - 1;

    return (
        <div className="flex items-center gap-1 py-1 min-w-0">
            {/* Logo */}
            <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center">
                <LogoDisplay
                    src={team.logoUrl}
                    alt={team.name}
                    triCode={team.triCode}
                    className="w-9 h-9 object-contain"
                    primaryColor={team.color1}
                />
            </div>

            {/* Entries */}
            <div className="flex items-stretch gap-1 overflow-x-auto">
                {entries.map((entry, i) => {
                    const odds = entry[field];
                    const d = entry[dirField];
                    const isOpen = entry.isOpen;
                    const isLatest = i === lastIdx && !isOpen;
                    const hasBg = isOpen || isLatest;

                    return (
                        <div
                            key={i}
                            className={`flex flex-col items-center justify-between rounded-lg px-2.5 pt-1.5 pb-1 min-w-[52px] flex-shrink-0 ${
                                hasBg ? 'bg-white/5' : 'bg-transparent'
                            }`}
                        >
                            {/* Arrow + Odds */}
                            <div className="flex items-center">
                                {!isOpen && <Arrow dir={d} />}
                                <span className="text-[13px] font-black font-mono leading-none text-neutral-300">
                                    {odds}
                                </span>
                            </div>
                            {/* Label / Timestamp */}
                            <span className={`text-[9px] font-mono mt-1 leading-none ${
                                hasBg ? 'text-neutral-500' : 'text-neutral-600'
                            }`}>
                                {isOpen ? 'Open' : fmt12(entry.timestamp)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
