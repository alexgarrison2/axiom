/**
 * Legacy entry point. The Teams table lives in components/teams-table/*;
 * /teams server-renders it with data. Without `initial` it loads the current
 * season's table from /api/teams/league/{seasonId} (cached per session).
 */
export { default } from './teams-table/TeamsTable';
