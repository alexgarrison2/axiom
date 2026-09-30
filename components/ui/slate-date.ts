/** "Tue, Sep 29" in Eastern time (the NHL's slate day). */
export function slateDateLabel(now = new Date()): string {
    return now.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
}

/** Dated home-page title, e.g. "NHL predictions for Tue, Sep 29 | Pony xG". */
export function homeTitle(now = new Date()): string {
    return `NHL predictions for ${slateDateLabel(now)} | Pony xG`;
}
