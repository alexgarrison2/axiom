import type { TvBroadcast } from '@/types/prediction';

type Logo = { src: string; w: number; h: number; px: number; crest?: boolean };

/** Box height for a logo: wide wordmarks get shorter so every badge carries similar visual weight. */
function fit(w: number, h: number, maxPx = 18): number {
    const ar = w / h;
    let px = Math.min(maxPx, Math.max(10, Math.round(Math.sqrt(600 / ar))));
    if (px * ar > 72) px = Math.round((72 / ar) * 10) / 10; // cap very wide wordmarks so two fit on a phone card
    return px;
}

const net = (file: string, w: number, h: number, ext: 'svg' | 'png' = 'svg'): Logo => ({ src: `/logos/networks/${file}.${ext}`, w, h, px: fit(w, h) });
/** Team-produced feeds without a network mark of their own use the club crest (/logos/{TRI}.svg, already cropped). */
const crest = (tri: string, w: number, h: number): Logo => ({ src: `/logos/${tri}.svg`, w, h, px: fit(w, h, 16), crest: true });

/**
 * Network logos in /logos/networks: official artwork (Wikimedia Commons / en.wikipedia uploads),
 * sanitised, dark-surface variants, viewBox cropped to the artwork. `w`/`h` are the intrinsic size,
 * used for the aspect ratio; `px` is the rendered height.
 */
const LOGOS: Record<string, Logo> = {
    // US national
    ABC: net('ABC', 1000, 1000),
    ESPN: net('ESPN', 81, 20),
    ESPN2: net('ESPN2', 1495, 283),
    ESPNPLUS: net('ESPNPLUS', 178, 36),
    DISNEYPLUS: net('DISNEYPLUS', 1033, 564),
    HULU: net('HULU', 216, 71),
    MAX: net('MAX', 1240, 895),
    NHLN: net('NHLN', 1000, 722),
    PRIME: net('PRIME', 84, 26.5),
    TBS: net('TBS', 94, 53),
    TNT: net('TNT', 1, 1),
    TRUTV: net('TRUTV', 484, 187),
    // Canada
    CBC: net('CBC', 505.5, 132),
    CITYTV: net('CITYTV', 608, 203),
    RDS: net('RDS', 540, 127),
    SN: net('SN', 466, 69),
    TSN: net('TSN', 193, 46.6),
    TVAS: net('TVAS', 200, 92.6),
    // US regional
    ABTV: net('ABTV', 1000, 396.5),
    ALT: net('ALT', 102.3, 53.9),
    CHSN: net('CHSN', 55, 64, 'png'),
    DSN: net('DSN', 205, 64, 'png'),
    FDSN: net('FDSN', 156.4, 44.4),
    KCOP: net('KCOP', 264.6, 107.4),
    KDFI: net('KDFI', 1000, 290.6),
    KDFW: net('KDFW', 1294, 540.6),
    KING: net('KING', 316.6, 128.2),
    KONG: net('KONG', 264.6, 65.2),
    KSTC: net('KSTC', 156, 64, 'png'),
    KTTV: net('KTTV', 1300, 531),
    KTVD: net('KTVD', 119, 79.5),
    KUSA: net('KUSA', 358.7, 79.3),
    MNMT: net('MNMT', 98, 64, 'png'),
    MSG: net('MSG', 240, 49.6),
    NBCS: net('NBCS', 1000, 710),
    NBCSCA: net('NBCSCA', 999.4, 324),
    NBCSP: net('NBCSP', 1000, 313.8),
    NBCSPPLUS: net('NBCSPPLUS', 1000, 313.8),
    NESN: net('NESN', 389, 64, 'png'),
    SCRIPPS: net('SCRIPPS', 241, 64, 'png'),
    SNPIT: net('SNPIT', 462, 100),
    THESPOT: net('THESPOT', 264.6, 162.4),
    UTAH16: net('UTAH16', 264.6, 161.9),
    VICTORY: net('VICTORY', 218.2, 25.8),
    // Team-produced streams and feeds
    CAR: crest('CAR', 681.8, 415.2),
    CBJ: crest('CBJ', 609.9, 529),
    EDM: crest('EDM', 574.3, 574.3),
    MIN: crest('MIN', 682.4, 445.4),
    STL: crest('STL', 562, 445.6),
};

/** NHL API network string (normalised by `key`) → logo key; variants and sub-feeds collapse to one brand. */
const ALIASES: Record<string, string> = {
    ABC: 'ABC',
    ESPN: 'ESPN',
    ESPN2: 'ESPN2',
    ESPNPLUS: 'ESPNPLUS',
    DISNEYPLUS: 'DISNEYPLUS',
    HULU: 'HULU',
    MAX: 'MAX',
    HBOMAX: 'MAX',
    NHLN: 'NHLN',
    NHLNETWORK: 'NHLN',
    PRIME: 'PRIME',
    PRIMEVIDEO: 'PRIME',
    AMAZONPRIME: 'PRIME',
    AMAZONPRIMEVIDEO: 'PRIME',
    KHNPRIME: 'PRIME',
    TBS: 'TBS',
    TNT: 'TNT',
    TRUTV: 'TRUTV',
    CBC: 'CBC',
    CITYTV: 'CITYTV',
    CITY: 'CITYTV',
    RDS: 'RDS',
    RDS2: 'RDS',
    RDSI: 'RDS',
    RDSINFO: 'RDS',
    SN: 'SN',
    SNPLUS: 'SN',
    SN1: 'SN',
    SNP: 'SN',
    SNO: 'SN',
    SNE: 'SN',
    SNW: 'SN',
    SN360: 'SN',
    SPORTSNET: 'SN',
    SPORTSNETPLUS: 'SN',
    TSN: 'TSN',
    TSN1: 'TSN',
    TSN2: 'TSN',
    TSN3: 'TSN',
    TSN4: 'TSN',
    TSN5: 'TSN',
    TVAS: 'TVAS',
    TVAS2: 'TVAS',
    TVASPORTS: 'TVAS',
    TVASPORTS2: 'TVAS',
    ABTV: 'ABTV',
    ALT: 'ALT',
    ALT2: 'ALT',
    ALTITUDE: 'ALT',
    CHSN: 'CHSN',
    CHSNPLUS: 'CHSN',
    DSN: 'DSN',
    KCOP: 'KCOP',
    KCOP13: 'KCOP',
    KDFI: 'KDFI',
    KDFW: 'KDFW',
    KDFW4: 'KDFW',
    KING: 'KING',
    KING5: 'KING',
    KONG: 'KONG',
    KSTC: 'KSTC',
    KSTC45: 'KSTC',
    KTTV: 'KTTV',
    KTVD: 'KTVD',
    KUSA: 'KUSA',
    MNMT: 'MNMT',
    MNMT2: 'MNMT',
    MSG: 'MSG',
    MSG2: 'MSG',
    MSGB: 'MSG',
    MSGSN: 'MSG',
    MSGSN2: 'MSG',
    MSGPLUS: 'MSG',
    NBCSCA: 'NBCSCA',
    NBCSP: 'NBCSP',
    NBCSPPLUS: 'NBCSPPLUS',
    NESN: 'NESN',
    NESNPLUS: 'NESN',
    SCRIPPS: 'SCRIPPS',
    SNPIT: 'SNPIT',
    SNPITPLUS: 'SNPIT',
    SPORTSNETPITTSBURGH: 'SNPIT',
    THESPOT: 'THESPOT',
    UTAH16: 'UTAH16',
    VICTORYPLUS: 'VICTORY',
    CARNHL: 'CAR',
    HHN: 'CAR',
    CBJNHL: 'CBJ',
    CBJHN: 'CBJ',
    OILERSPLUS: 'EDM',
    MINNHL: 'MIN',
    WILDPLUS: 'MIN',
    STLNHL: 'STL',
    BNPLUS: 'STL',
    BLUESAPP: 'STL',
};

/** Families whose feed codes vary (FanDuel SN Detroit, NBCS Chicago, TSN regional, ...): prefix → logo key. */
const PREFIXES: [string, string][] = [
    ['FANDUELSPORTSNETWORK', 'FDSN'],
    ['FANDUELSN', 'FDSN'],
    ['FDSN', 'FDSN'],
    ['NBCSPORTS', 'NBCS'],
    ['NBCS', 'NBCS'],
    ['MSG', 'MSG'],
    ['TSN', 'TSN'],
    ['RDS', 'RDS'],
    ['TVASPORTS', 'TVAS'],
    ['SPORTSNET', 'SN'],
];

/** Friendlier text (and accessible names) for raw NHL API codes. */
const LABELS: Record<string, string> = {
    ESPNPLUS: 'ESPN+',
    DISNEYPLUS: 'Disney+',
    HULU: 'Hulu',
    MAX: 'HBO Max',
    HBOMAX: 'HBO Max',
    NHLN: 'NHL Network',
    NHLNETWORK: 'NHL Network',
    AMAZONPRIME: 'Prime Video',
    PRIME: 'Prime Video',
    KHNPRIME: 'Kraken Hockey Network on Prime Video',
    TRUTV: 'truTV',
    CITYTV: 'Citytv',
    RDS2: 'RDS2',
    RDSI: 'RDS Info',
    SN: 'Sportsnet',
    SNPLUS: 'Sportsnet+',
    SN1: 'Sportsnet One',
    SNP: 'Sportsnet Pacific',
    SNO: 'Sportsnet Ontario',
    SNE: 'Sportsnet East',
    SNW: 'Sportsnet West',
    SN360: 'Sportsnet 360',
    TVAS: 'TVA Sports',
    TVAS2: 'TVA Sports 2',
    ABTV: 'Angels Broadcast Television',
    ALT: 'Altitude Sports',
    ALT2: 'Altitude Sports 2',
    CHSN: 'Chicago Sports Network',
    CHSNPLUS: 'CHSN+',
    DSN: 'Detroit SportsNet',
    KCOP13: 'KCOP 13',
    KDFW4: 'KDFW Fox 4',
    KING: 'KING 5',
    KSTC: 'KSTC 45',
    KTTV: 'KTTV Fox 11',
    KTVD: 'KTVD 20',
    KUSA: 'KUSA 9News',
    MNMT: 'Monumental Sports Network',
    MNMT2: 'Monumental Sports Network 2',
    MSGSN: 'MSG Sportsnet',
    MSGSN2: 'MSG Sportsnet 2',
    NBCSCA: 'NBC Sports California',
    NBCSP: 'NBC Sports Philadelphia',
    NBCSPPLUS: 'NBC Sports Philadelphia+',
    NBCSWA: 'NBC Sports Washington',
    NBCSCH: 'NBC Sports Chicago',
    NESNPLUS: 'NESN+',
    SCRIPPS: 'Scripps Sports',
    SNPIT: 'SportsNet Pittsburgh',
    SNPITPLUS: 'SportsNet Pittsburgh+',
    UTAH16: 'Utah 16',
    BLUESAPP: 'Blues App',
};

const key = (network: string) => network.toUpperCase().replace(/\+/g, 'PLUS').replace(/[^A-Z0-9]/g, '');

export function networkLogo(network: string): Logo | undefined {
    const k = key(network);
    const alias = ALIASES[k] ?? PREFIXES.find(([p]) => k.startsWith(p))?.[1];
    return alias ? LOGOS[alias] : undefined;
}

export function networkLabel(network: string): string {
    return LABELS[key(network)] ?? network.trim();
}

/** Below ~360px of card width (phones) the pills tighten up and drop the team tag so two networks fit. */
const PILL =
    'inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-chip border border-line px-1 py-px text-micro font-medium tracking-normal text-fg-3 [@container(min-width:22.5rem)]:px-1.5 [@container(min-width:22.5rem)]:tracking-chip';

/** The card's TV networks: a logo when we have one, else the text pill. */
export function NetworkBadges({ tv }: { tv: TvBroadcast[] }) {
    // Collapse entries that resolve to the same logo (e.g. SNP + SN1 → one SN).
    const seen = new Set<string>();
    const items = tv.filter(b => {
        const logo = networkLogo(b.network);
        const k = logo ? `logo:${logo.src}:${b.team ?? ''}` : `net:${key(b.network)}:${b.team ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    if (!items.length) return null;
    return (
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden" data-testid="tv-networks">
            <span className="sr-only">TV: </span>
            {items.map(b => {
                const logo = networkLogo(b.network);
                const label = networkLabel(b.network);
                const name = b.team ? `${label} (${b.team} broadcast)` : label;
                // A club crest already names the team, so it skips the text tag.
                const tag = b.team && !logo?.crest ? <span aria-hidden="true" className="hidden font-bold text-fg-2 [@container(min-width:22.5rem)]:inline">{b.team}</span> : null;
                if (logo) {
                    const width = Math.round((logo.px * logo.w) / logo.h);
                    const img = (
                        // eslint-disable-next-line @next/next/no-img-element -- tiny static logos, no optimisation needed
                        <img
                            src={logo.src}
                            alt={name}
                            title={name}
                            width={width}
                            height={logo.px}
                            decoding="async"
                            className="block shrink-0 object-contain"
                            style={{ height: logo.px, width }}
                        />
                    );
                    return tag ? (
                        <span key={`${b.market}${b.network}`} className="inline-flex shrink-0 items-center gap-1 text-micro tracking-chip">
                            {tag}
                            {img}
                        </span>
                    ) : (
                        <span key={`${b.market}${b.network}`} className="inline-flex shrink-0 items-center">{img}</span>
                    );
                }
                return (
                    <span key={`${b.market}${b.network}`} className={PILL} title={name}>
                        {tag}
                        <span className="truncate">{label}</span>
                        {b.team ? <span className="sr-only"> ({b.team} broadcast)</span> : null}
                    </span>
                );
            })}
        </span>
    );
}

export default NetworkBadges;
