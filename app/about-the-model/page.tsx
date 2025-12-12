import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Brain, Activity, ShieldCheck, Flame, Coins, Zap } from 'lucide-react';

export const metadata = {
    title: "How It Works | Pony xG",
    description: "Deep dive into the mechanics of the Pony xG NHL prediction model.",
};

export default function AboutModelPage() {
    return (
        <main className="min-h-screen bg-black text-white p-4 font-sans relative overflow-x-hidden selection:bg-emerald-500/30">
            {/* Background Ambient Glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-purple-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

            <div className="max-w-4xl mx-auto relative z-10 pt-8 pb-24">
                {/* Header / Nav */}
                <div className="flex items-center justify-between mb-12">
                    <Link
                        href="/"
                        className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors duration-300 group"
                    >
                        <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                        <span className="font-mono text-sm tracking-widest uppercase">Back to Predictions</span>
                    </Link>
                </div>

                {/* Title Section */}
                <div className="mb-16">
                    <h1 className="text-4xl md:text-6xl font-black tracking-tighter mb-6 bg-gradient-to-r from-white via-neutral-200 to-neutral-500 bg-clip-text text-transparent">
                        THE MECHANICS OF <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-purple-500">PONY XG</span>
                    </h1>
                    <p className="text-lg md:text-xl text-neutral-400 leading-relaxed max-w-2xl">
                        A transparency report on how we turn raw NHL data into actionable edges. No black boxes, just math, code, and hockey.
                    </p>
                </div>

                {/* Content Grid */}
                <div className="space-y-24">

                    {/* Section 1: The Core Engine */}
                    <Section
                        icon={<Brain className="w-8 h-8 text-neon-blue" />}
                        title="The Core Engine"
                        gradient="from-neon-blue/20"
                    >
                        <p className="text-neutral-300 mb-6 leading-relaxed">
                            At the heart of the model lies a <strong>Poisson Distribution Simulation</strong>. Unlike simple ELO ratings that just track wins and losses, we simulate the game thousands of times based on the expected event rates.
                        </p>
                        <p className="text-neutral-300 leading-relaxed">
                            We calculate a tailored <strong>Expected Goals (xG)</strong> value for both the Home and Away teams. These values aren't just averages; they are dynamically adjusted based on opponent strength, recent form, and venue effects. We then feed these xG rates into the Poisson distribution to calculate the precise probability of every possible scoreline (e.g., 3-2, 4-1, 5-4 OT).
                        </p>
                    </Section>

                    {/* Section 2: Input Variables */}
                    <Section
                        icon={<Activity className="w-8 h-8 text-emerald-400" />}
                        title="The Inputs"
                        gradient="from-emerald-400/20"
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                            <FeatureCard
                                title="5v5 Team Form"
                                description="We strip away special teams noise to evaluate a team's true baseline performance. We analyze chances created (xGF) and chances suppressed (xGA) to build a robust strength rating."
                            />
                            <FeatureCard
                                title="Situational Factors"
                                description="Context matters. We apply specific penalties for teams playing on back-to-back nights (fatigue) and adjust for Home Ice Advantage based on current league-wide trends."
                            />
                        </div>
                    </Section>

                    {/* Section 3: The Equalizers */}
                    <Section
                        icon={<ShieldCheck className="w-8 h-8 text-amber-400" />}
                        title="The Great Equalizers"
                        gradient="from-amber-400/20"
                    >
                        <p className="text-neutral-300 mb-6 leading-relaxed">
                            Goaltending is the most volatile variable in hockey. We don't just use save percentage. We integrate <strong>Goals Saved Above Expected (GSAx)</strong>.
                        </p>
                        <div className="bg-white/5 border border-white/10 rounded-xl p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-20">
                                <Zap className="w-24 h-24 text-amber-400" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Dynamic Starter Updates</h3>
                            <p className="text-sm text-neutral-400">
                                The model scrapes confirmed starting goalies in real-time. If a backup is confirmed, the team's defensive rating is immediately penalized based on the drop-off in GSAx from the starter.
                            </p>
                        </div>
                    </Section>

                    {/* Section 4: Star Power */}
                    <Section
                        icon={<Flame className="w-8 h-8 text-red-500" />}
                        title="Star Power & Injury Impact"
                        gradient="from-red-500/20"
                    >
                        <p className="text-neutral-300 leading-relaxed">
                            Hockey is a team sport, but some players tilt the ice. The model monitors the lineup status of game-breaking talent (e.g., McDavid, MacKinnon, Kucherov). If a superstar is ruled out, a "Star Penalty" is applied to the team's offensive generation projection, preventing the model from overestimating a depleted roster.
                        </p>
                    </Section>

                    {/* Section 5: The Betting Edge */}
                    <Section
                        icon={<Coins className="w-8 h-8 text-purple-400" />}
                        title="Finding the Edge"
                        gradient="from-purple-400/20"
                    >
                        <p className="text-neutral-300 mb-6 leading-relaxed">
                            Predictions are useless without context. We compare our calculated Win Probability against the <strong>Live Vegas Odds</strong> to calculate <strong>Expected Value (EV)</strong>.
                        </p>
                        <ul className="space-y-4">
                            <li className="flex items-start gap-3">
                                <div className="min-w-[4px] h-[24px] bg-purple-500 rounded-full mt-1"></div>
                                <div>
                                    <strong className="text-white block">Kelly Criterion Sizing</strong>
                                    <span className="text-neutral-400 text-sm">We don't flat bet. We recommend wager sizes based on the "Quarter Kelly" criterion—betting more when the edge is massive, and staying away when the edge is slim.</span>
                                </div>
                            </li>
                        </ul>
                    </Section>

                </div>

                {/* Footer Quote */}
                <div className="mt-32 border-t border-white/10 pt-16 text-center">
                    <p className="font-neonderthaw text-4xl text-neutral-500">
                        "All models are wrong, some are useful."
                    </p>
                </div>
            </div>
        </main>
    );
}

// Subcomponents for cleaner code
function Section({ icon, title, gradient, children }: { icon: React.ReactNode, title: string, gradient: string, children: React.ReactNode }) {
    return (
        <section className="relative group">
            {/* Glow Effect */}
            <div className={`absolute -inset-4 bg-gradient-to-r ${gradient} to-transparent rounded-2xl blur-2xl opacity-0 group-hover:opacity-10 transition-opacity duration-700`}></div>

            <div className="relative">
                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10 backdrop-blur-sm">
                        {icon}
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{title}</h2>
                </div>
                <div className="pl-2 md:pl-20 border-l-2 border-white/5">
                    {children}
                </div>
            </div>
        </section>
    );
}

function FeatureCard({ title, description }: { title: string, description: string }) {
    return (
        <div className="glass-panel p-6 rounded-xl border border-white/5 hover:border-white/20 transition-colors duration-300">
            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
            <p className="text-sm text-neutral-400 leading-relaxed">{description}</p>
        </div>
    );
}
