"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GamePrediction } from '@/utils/data';
import { supabase } from '@/utils/supabaseClient';
import { X, Loader2 } from 'lucide-react';

interface LogBetModalProps {
    isOpen: boolean;
    onClose: () => void;
    prediction: GamePrediction;
}

type TeamInfo = { name: string; triCode: string };

const LogBetModal: React.FC<LogBetModalProps> = ({ isOpen, onClose, prediction }) => {
    const [teamSelected, setTeamSelected] = useState<'Home' | 'Away'>('Home');
    const [betType, setBetType] = useState<string>('Moneyline');

    // Form fields
    const [odds, setOdds] = useState<string>('');
    const [wagerUnits, setWagerUnits] = useState<string>('1.0');
    const [spread, setSpread] = useState<string>('');
    const [total, setTotal] = useState<string>('');
    const [overUnder, setOverUnder] = useState<'Over' | 'Under'>('Over');
    const [notes, setNotes] = useState<string>('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!isOpen || !mounted) return null;

    const betTypes = ['Moneyline', 'Puck Line', '3-Way', 'Team Total'];
    const hTeam = prediction.homeTeam as unknown as TeamInfo;
    const aTeam = prediction.awayTeam as unknown as TeamInfo;
    const selectedTeamName = teamSelected === 'Home' ? hTeam.name : aTeam.name;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setErrorMsg(null);
        setSuccessMsg(null);

        // Validation & Parsings
        const parsedOdds = parseInt(odds, 10);
        if (isNaN(parsedOdds)) {
            setErrorMsg("Odds must be a valid integer.");
            setIsSubmitting(false);
            return;
        }

        const parsedUnits = parseFloat(wagerUnits);
        if (isNaN(parsedUnits) || parsedUnits <= 0) {
            setErrorMsg("Wager units must be a positive number.");
            setIsSubmitting(false);
            return;
        }

        let parsedSpread: number | null = null;
        if (betType === 'Puck Line') {
            parsedSpread = parseFloat(spread);
            if (isNaN(parsedSpread)) {
                setErrorMsg("Spread must be a valid number.");
                setIsSubmitting(false);
                return;
            }
        }

        let parsedTotal: number | null = null;
        let finalOverUnder: string | null = null;
        if (betType === 'Team Total') {
            parsedTotal = parseFloat(total);
            if (isNaN(parsedTotal)) {
                setErrorMsg("Total must be a valid number.");
                setIsSubmitting(false);
                return;
            }
            finalOverUnder = overUnder;
        }

        try {
            if (!supabase) {
                throw new Error("Supabase client not configured. Restart dev server to pick up .env.local changes.");
            }
            const hTeam = prediction.homeTeam as unknown as TeamInfo;
            const aTeam = prediction.awayTeam as unknown as TeamInfo;
            const { error } = await supabase.from('bet_logs').insert([{
                game_id: `${hTeam.triCode}vs${aTeam.triCode}_${prediction.startTime}`, // Use a composite or specific logic if you have actual game IDs
                game_date: prediction.startTime, // Assuming startTime string serves as date
                home_team: hTeam.name,
                away_team: aTeam.name,
                team_selected: selectedTeamName,
                bet_type: betType,
                spread: parsedSpread,
                total: parsedTotal,
                over_under: finalOverUnder,
                odds: parsedOdds,
                wager_units: parsedUnits,
                notes: notes || null
            }]);

            if (error) throw error;

            setSuccessMsg("Bet logged successfully!");
            setTimeout(() => {
                onClose();
                // Reset form
                setOdds('');
                setSpread('');
                setTotal('');
                setNotes('');
                setSuccessMsg(null);
            }, 1000);
        } catch (err: unknown) {
            console.error("Error logging bet:", err);
            const msg = err instanceof Error ? err.message : String(err);
            setErrorMsg(msg || "An error occurred while saving.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        >
            <div className="bg-zinc-900 border border-white/10 rounded-xl w-full max-w-md shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-white/10 shrink-0">
                    <h2 className="text-xl font-bold font-mono text-white">Log Bet</h2>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full text-zinc-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body (Scrollable) */}
                <div className="p-4 overflow-y-auto w-full custom-scrollbar">
                    {errorMsg && (
                        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
                            {errorMsg}
                        </div>
                    )}
                    {successMsg && (
                        <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm">
                            {successMsg}
                        </div>
                    )}

                    <form id="logBetForm" onSubmit={handleSubmit} className="flex flex-col gap-5">

                        {/* Team Toggle */}
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Team Selected</label>
                            <div className="flex rounded-lg overflow-hidden border border-white/10 p-1 bg-black/30">
                                <button
                                    type="button"
                                    onClick={() => setTeamSelected('Home')}
                                    className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${teamSelected === 'Home' ? 'bg-white/15 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    {(prediction.homeTeam as unknown as TeamInfo).name} (Home)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTeamSelected('Away')}
                                    className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${teamSelected === 'Away' ? 'bg-white/15 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    {(prediction.awayTeam as unknown as TeamInfo).name} (Away)
                                </button>
                            </div>
                        </div>

                        {/* Bet Type */}
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Bet Type</label>
                            <div className="grid grid-cols-2 gap-2">
                                {betTypes.map(type => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => setBetType(type)}
                                        className={`py-2 px-3 text-sm font-medium rounded-lg border transition-colors ${betType === type ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Dynamic Inputs */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* Spread (Only for Puck Line) */}
                            {betType === 'Puck Line' && (
                                <div className="col-span-1">
                                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Spread</label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={spread}
                                        onChange={(e) => setSpread(e.target.value)}
                                        placeholder="-1.5"
                                        className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 placeholder-zinc-600"
                                        required
                                    />
                                </div>
                            )}

                            {/* Total & Over/Under (Only for Team Total) */}
                            {betType === 'Team Total' && (
                                <>
                                    <div className="col-span-1">
                                        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">O/U</label>
                                        <div className="flex rounded-lg overflow-hidden border border-white/10 bg-black/30 w-full h-[38px]">
                                            <button
                                                type="button"
                                                onClick={() => setOverUnder('Over')}
                                                className={`flex-1 text-sm font-semibold transition-colors ${overUnder === 'Over' ? 'bg-white/15 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                            >
                                                O
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setOverUnder('Under')}
                                                className={`flex-1 text-sm font-semibold transition-colors ${overUnder === 'Under' ? 'bg-white/15 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                            >
                                                U
                                            </button>
                                        </div>
                                    </div>
                                    <div className="col-span-1">
                                        <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Total</label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={total}
                                            onChange={(e) => setTotal(e.target.value)}
                                            placeholder="2.5"
                                            className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 placeholder-zinc-600"
                                            required
                                        />
                                    </div>
                                </>
                            )}

                            {/* Odds (Always visible) */}
                            <div className="col-span-1">
                                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Odds</label>
                                <input
                                    type="text"
                                    value={odds}
                                    onChange={(e) => setOdds(e.target.value)}
                                    placeholder="-110 or +150"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 placeholder-zinc-600"
                                    required
                                />
                            </div>
                        </div>

                        {/* Wager Units */}
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Wager (Units)</label>
                            <input
                                type="number"
                                step="any"
                                min="0.01"
                                value={wagerUnits}
                                onChange={(e) => setWagerUnits(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 placeholder-zinc-600"
                                required
                            />
                        </div>

                        {/* Notes */}
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Notes (Optional)</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Why are you taking this bet?"
                                rows={2}
                                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 placeholder-zinc-600 custom-scrollbar resize-none"
                            />
                        </div>

                        {/* Preview */}
                        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                            <p className="text-sm text-blue-200">
                                Logging <span className="font-bold text-white">{wagerUnits}u</span> on <span className="font-bold text-white">{selectedTeamName}</span>
                                {' '}
                                <span className="font-mono text-xs bg-blue-500/30 px-1 py-0.5 rounded text-blue-100">
                                    {betType}
                                </span>
                                {betType === 'Puck Line' && spread && ` (${spread})`}
                                {betType === 'Team Total' && total && ` (${overUnder} ${total})`}
                                {odds && ` @ ${odds}`}
                            </p>
                        </div>

                    </form>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 shrink-0">
                    <button
                        type="submit"
                        form="logBetForm"
                        disabled={isSubmitting}
                        className="w-full flex justify-center items-center py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <><Loader2 size={18} className="animate-spin mr-2" /> Saving...</>
                        ) : (
                            'Log Bet'
                        )}
                    </button>
                </div>

            </div>
        </div>,
        document.body
    );
};

export default LogBetModal;
