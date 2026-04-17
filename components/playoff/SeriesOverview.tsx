'use client';

import React from 'react';
import ScheduleStrip from './ScheduleStrip';
import H2HGameLog from './H2HGameLog';
import TornadoChart from './TornadoChart';
import SeriesOdds from './SeriesOdds';
import PlayoffHistory from './PlayoffHistory';
import LineupGrid from '@/components/LineupGrid';
import { teamColor } from './PlayoffHub';
import type { PlayoffSeries, TeamInfo, TeamRatings, H2HGame } from '@/app/playoffs/page';
import type { GamePrediction } from '@/utils/data';

interface SeriesOverviewProps {
  series: PlayoffSeries;
  teamsMap: Record<string, TeamInfo>;
  ratings: TeamRatings;
  triToCommon: Record<string, string>;
  h2hGames: H2HGame[];
  lineups: Record<string, any>;
  playerNews: Record<string, any[]>;
  playoffPlayerNews: Record<string, any[]>;
  prediction?: GamePrediction;
  teamGoalies?: Record<string, string[]>;
  goalieStatsMap?: Record<string, string>;
  playoffHistory?: any[];
  teamStatsExtended?: Record<string, any>;
  goalieRatings?: Record<string, any>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-widest text-neutral-500 font-semibold mb-2">
      {children}
    </div>
  );
}

export default function SeriesOverview({ series, teamsMap, ratings, triToCommon, h2hGames, lineups, playerNews, playoffPlayerNews, prediction, teamGoalies, goalieStatsMap, playoffHistory, teamStatsExtended, goalieRatings }: SeriesOverviewProps) {
  const t1 = series.higherSeed.triCode;
  const t2 = series.lowerSeed.triCode;
  const c1 = teamColor(t1, teamsMap);
  const c2 = teamColor(t2, teamsMap);
  const name1 = triToCommon[t1] ?? t1;
  const name2 = triToCommon[t2] ?? t2;

  // Determine starters and next game home team for TornadoChart filters
  const homeIst1 = prediction?.homeTeam?.triCode === t1;
  const t1Goalie = homeIst1 ? prediction?.homeStarter : prediction?.awayStarter;
  const t2Goalie = homeIst1 ? prediction?.awayStarter : prediction?.homeStarter;
  const nextGameHomeTriCode = (() => {
    const nextGame = series.games.find(g => g.status === 'scheduled' || g.status === 'live');
    return nextGame?.homeTriCode ?? undefined;
  })();

  return (
    <div className="space-y-3">
      {/* Series Title */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <div className="flex items-center justify-center gap-3">
          <img src={`/logos/${t1}.svg`} alt={t1} className="w-8 h-8" />
          <div className="text-center">
            <div className="text-sm font-bold text-neutral-300">Series Preview</div>
            <div className="text-xs text-neutral-500">
              ({series.higherSeed.seed}) {name1} vs ({series.lowerSeed.seed}) {name2}
            </div>
          </div>
          <img src={`/logos/${t2}.svg`} alt={t2} className="w-8 h-8" />
        </div>
      </div>

      {/* Schedule Strip */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Series Schedule</SectionHeader>
        <ScheduleStrip series={series} teamsMap={teamsMap} />
      </div>

      {/* Series Odds & Probabilities — moved up */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Series Odds & Model Probabilities</SectionHeader>
        <SeriesOdds
          series={series}
          teamsMap={teamsMap}
          ratings={ratings}
          triToCommon={triToCommon}
        />
      </div>

      {/* H2H Game Log */}
      {h2hGames.length > 0 && (
        <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
          <SectionHeader>Regular Season Matchups</SectionHeader>
          <H2HGameLog games={h2hGames} t1={t1} t2={t2} c1={c1} c2={c2} teamsMap={teamsMap} />
        </div>
      )}

      {/* Playoff History */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Playoff History</SectionHeader>
        <PlayoffHistory
          t1={t1}
          t2={t2}
          teamsMap={teamsMap}
          history={playoffHistory ?? []}
        />
      </div>

      {/* Tornado Chart */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Team Stats Comparison</SectionHeader>
        <TornadoChart
          t1={t1} t2={t2} c1={c1} c2={c2}
          name1={name1} name2={name2}
          ratings={ratings}
          triToCommon={triToCommon}
          extendedStats={teamStatsExtended}
          goalieRatings={goalieRatings}
          t1Goalie={t1Goalie}
          t2Goalie={t2Goalie}
          nextGameHomeTriCode={nextGameHomeTriCode}
        />
      </div>

      {/* Lineups — using real LineupGrid component */}
      {(() => {
        // homeIst1, t1Goalie, t2Goalie already computed above
        const t1GoalieStats = homeIst1 ? prediction?.home_goalie_stats : prediction?.away_goalie_stats;
        const t2GoalieStats = homeIst1 ? prediction?.away_goalie_stats : prediction?.home_goalie_stats;
        const t1Gsax = homeIst1 ? prediction?.home_gsax : prediction?.away_gsax;
        const t2Gsax = homeIst1 ? prediction?.away_gsax : prediction?.home_gsax;
        const t1GsaxPct = homeIst1 ? prediction?.home_gsax_pct : prediction?.away_gsax_pct;
        const t2GsaxPct = homeIst1 ? prediction?.away_gsax_pct : prediction?.home_gsax_pct;
        // Backup goalies: first in teamGoalies list that isn't the starter
        const getBackup = (tri: string, starter?: string) => {
          const list = teamGoalies?.[tri] ?? [];
          return list.find(g => g.toLowerCase() !== (starter ?? '').toLowerCase());
        };
        const t1Backup = getBackup(t1, t1Goalie);
        const t2Backup = getBackup(t2, t2Goalie);
        const t1BackupStats = t1Backup ? goalieStatsMap?.[t1Backup] : undefined;
        const t2BackupStats = t2Backup ? goalieStatsMap?.[t2Backup] : undefined;
        return (
          <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
            <SectionHeader>Projected Lineups</SectionHeader>
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <img src={`/logos/${t1}.svg`} alt={t1} className="w-4 h-4" />
                  <span className="text-xs font-semibold" style={{ color: c1 }}>{name1}</span>
                </div>
                <LineupGrid lineup={lineups[t1]} triCode={t1} goalieStarter={t1Goalie} gsaxPerGame={t1Gsax} gsaxPct={t1GsaxPct} goalieStatLine={t1GoalieStats} backupGoalie={t1Backup} backupGoalieStatLine={t1BackupStats} />
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <img src={`/logos/${t2}.svg`} alt={t2} className="w-4 h-4" />
                  <span className="text-xs font-semibold" style={{ color: c2 }}>{name2}</span>
                </div>
                <LineupGrid lineup={lineups[t2]} triCode={t2} goalieStarter={t2Goalie} gsaxPerGame={t2Gsax} gsaxPct={t2GsaxPct} goalieStatLine={t2GoalieStats} backupGoalie={t2Backup} backupGoalieStatLine={t2BackupStats} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Team News */}
      <div className="backdrop-blur-xl bg-white/[0.03] border border-white/10 rounded-2xl p-3">
        <SectionHeader>Team News</SectionHeader>
        <TeamNewsSection t1={t1} t2={t2} c1={c1} c2={c2} playerNews={playoffPlayerNews} teamsMap={teamsMap} />
      </div>
    </div>
  );
}

// ─── Team News ───────────────────────────────────────────────────────────────
function TeamNewsSection({ t1, t2, c1, c2, playerNews, teamsMap }: {
  t1: string; t2: string; c1: string; c2: string;
  playerNews: Record<string, any[]>; teamsMap: Record<string, TeamInfo>;
}) {
  const [expandedDates, setExpandedDates] = React.useState<Set<string>>(new Set());

  // Merge both teams' news, tag with team, sort by timestamp desc
  const allItems = React.useMemo(() => {
    const items: any[] = [];
    for (const [tri, color] of [[t1, c1], [t2, c2]] as [string, string][]) {
      (playerNews[tri] ?? []).forEach(item => items.push({ ...item, tri, color }));
    }
    return items.sort((a, b) => {
      const ta = a.timestamp ?? a.date ?? '';
      const tb = b.timestamp ?? b.date ?? '';
      return tb.localeCompare(ta);
    });
  }, [t1, t2, c1, c2, playerNews]);

  if (allItems.length === 0) {
    return <div className="text-xs text-neutral-600 text-center py-2">No recent news</div>;
  }

  // Group by date string (YYYY-MM-DD)
  const grouped = React.useMemo(() => {
    const map = new Map<string, any[]>();
    allItems.forEach(item => {
      const d = item.date ?? item.timestamp?.slice(0, 10) ?? 'Unknown';
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(item);
    });
    return Array.from(map.entries()); // sorted by date desc (since allItems sorted)
  }, [allItems]);

  const formatTs = (item: any): string => {
    if (!item.timestamp) return item.date ?? '';
    try {
      return new Date(item.timestamp).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        hour12: true, timeZone: 'America/Chicago',
      }).toUpperCase();
    } catch { return item.date ?? ''; }
  };

  const formatDateLabel = (d: string): string => {
    try {
      const dt = new Date(d + 'T12:00:00');
      return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
    } catch { return d; }
  };

  return (
    <div className="space-y-2">
      {grouped.map(([date, items], gi) => {
        const isFirst = gi === 0;
        const isExpanded = isFirst || expandedDates.has(date);
        return (
          <div key={date}>
            {/* Date header with toggle */}
            <button
              className="w-full flex items-center gap-2 mb-1 group"
              onClick={() => {
                if (isFirst) return; // first group always expanded
                setExpandedDates(prev => {
                  const next = new Set(prev);
                  if (next.has(date)) next.delete(date); else next.add(date);
                  return next;
                });
              }}
            >
              <span className="text-[10px] font-mono font-bold text-neutral-500 uppercase tracking-widest">
                {formatDateLabel(date)}
              </span>
              <div className="flex-1 h-px bg-white/5" />
              {!isFirst && (
                <span className="text-[10px] font-bold text-neutral-600 group-hover:text-neutral-400 transition-colors w-4 text-center">
                  {isExpanded ? '−' : '+'}
                </span>
              )}
              {isFirst && (
                <span className="text-[10px] font-mono text-neutral-600">{items.length}</span>
              )}
            </button>

            {/* Items */}
            {isExpanded && (
              <div className="space-y-1">
                {items.map((item, i) => (
                  <div key={i} className="pl-2 py-1 border-l-2" style={{ borderColor: item.color + '80' }}>
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <img src={`/logos/${item.tri}.svg`} alt={item.tri} className="w-3 h-3" />
                      <span className="text-xs font-semibold text-neutral-300">{item.player}</span>
                      {item.category && (
                        <span className={`text-[10px] font-mono font-bold uppercase px-1 rounded border ${
                          item.category.toLowerCase().includes('injury')
                            ? 'text-red-400 bg-red-400/10 border-red-400/20'
                            : 'text-blue-400 bg-blue-400/10 border-blue-400/20'
                        }`}>
                          {item.category}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-neutral-600 font-mono">{formatTs(item)}</span>
                    </div>
                    <p className="text-xs text-neutral-400 leading-snug ml-4.5">{item.news}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
