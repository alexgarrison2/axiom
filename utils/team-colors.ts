
export const TEAM_COLORS: Record<string, string> = {
    ANA: '#F47A38', // Orange
    BOS: '#fcb514', // Yellow/Gold
    BUF: '#002654', // Navy
    CAR: '#CC0000', // Red
    CBJ: '#002654', // Navy
    CGY: '#C8102E', // Red
    CHI: '#CF0A2C', // Red
    COL: '#6F263D', // Burgundy
    DAL: '#006847', // Victory Green
    DET: '#CE1126', // Red
    EDM: '#041E42', // Navy (Official)
    FLA: '#C8102E', // Red
    LAK: '#111111', // Black/Silver
    MIN: '#004F30', // Forest Green
    MTL: '#AF1E2D', // Red
    NJD: '#CE1126', // Red
    NSH: '#FFB81C', // Gold
    NYI: '#00539B', // Blue
    NYR: '#0038A8', // Blue
    OTT: '#C52032', // Red
    PHI: '#F74902', // Orange
    PIT: '#FCB514', // Gold (Yellow)
    SEA: '#001628', // Deep Sea Blue
    SJS: '#006D75', // Teal
    STL: '#002F87', // Blue
    TBL: '#002868', // Blue
    TOR: '#00205B', // Navy
    UTA: '#71AFE5', // Utah Blue (Temporary/New)
    VAN: '#00205B', // Blue
    VGK: '#B4975A', // Gold
    WPG: '#041E42', // Navy
    WSH: '#C8102E', // Red
};

export const getTeamColor = (tricode: string): string => {
    return TEAM_COLORS[tricode] || '#000000';
};
