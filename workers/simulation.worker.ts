// workers/simulation.worker.ts

import { SeasonSimulator, TeamStandings, SimResult } from '../utils/simulation-engine';
import { SimGame } from '../utils/schedule';

// Define the incoming message format
type WorkerMessage = {
    type: 'RUN_SIMULATION';
    schedule: SimGame[];
    standings: TeamStandings[];
    iterations: number;
};

// Define the outgoing response format
type WorkerResponse = {
    type: 'SIMULATION_COMPLETE';
    results: Record<string, SimResult>; // Map converted to object for transfer
};

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    if (e.data.type === 'RUN_SIMULATION') {
        const { schedule, standings, iterations } = e.data;

        // Run the heavy simulation
        const simulator = new SeasonSimulator(standings, schedule);
        const resultsMap = simulator.runMonteCarlo(iterations);

        // Convert Map to Object for serialization
        const resultsObj: Record<string, SimResult> = {};
        resultsMap.forEach((val, key) => {
            resultsObj[key] = val;
        });

        const response: WorkerResponse = {
            type: 'SIMULATION_COMPLETE',
            results: resultsObj
        };

        self.postMessage(response);
    }
};
