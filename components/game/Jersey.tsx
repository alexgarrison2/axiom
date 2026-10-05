import * as React from 'react';
import { Big_Shoulders, Chakra_Petch, Graduate } from 'next/font/google';

/*
 * Sweater-number badges. Club number fonts are licensed, so each team gets the
 * closest free athletic face: block (most clubs), varsity slab (the clubs with
 * collegiate numbers) or squared modern (the custom angular sets).
 */
const block = Big_Shoulders({ subsets: ['latin'], weight: '900', display: 'swap' });
const varsity = Graduate({ subsets: ['latin'], weight: '400', display: 'swap' });
const modern = Chakra_Petch({ subsets: ['latin'], weight: '700', display: 'swap' });

type Face = 'block' | 'varsity' | 'modern';
const FACES: Record<Face, { family: string; scale: number }> = {
    block: { family: block.style.fontFamily, scale: 0.7 },
    varsity: { family: varsity.style.fontFamily, scale: 0.5 },
    modern: { family: modern.style.fontFamily, scale: 0.56 },
};

/** Home sweater: body colour, number colour, number trim. */
interface Sweater {
    fill: string;
    num: string;
    trim: string | null;
    face: Face;
}

export const SWEATERS: Record<string, Sweater> = {
    ANA: { fill: '#F47A38', num: '#111111', trim: '#FFFFFF', face: 'modern' },
    BOS: { fill: '#111111', num: '#FFB81C', trim: '#FFFFFF', face: 'block' },
    BUF: { fill: '#003087', num: '#FFB81C', trim: '#FFFFFF', face: 'block' },
    CAR: { fill: '#CC0000', num: '#FFFFFF', trim: '#111111', face: 'modern' },
    CBJ: { fill: '#002654', num: '#FFFFFF', trim: '#CE1126', face: 'modern' },
    CGY: { fill: '#C8102E', num: '#FFFFFF', trim: '#F1BE48', face: 'block' },
    CHI: { fill: '#CF0A2C', num: '#111111', trim: '#FFFFFF', face: 'varsity' },
    COL: { fill: '#6F263D', num: '#FFFFFF', trim: '#236192', face: 'block' },
    DAL: { fill: '#006847', num: '#FFFFFF', trim: '#111111', face: 'modern' },
    DET: { fill: '#CE1126', num: '#FFFFFF', trim: null, face: 'block' },
    EDM: { fill: '#FF4C00', num: '#041E42', trim: '#FFFFFF', face: 'block' },
    FLA: { fill: '#C8102E', num: '#FFFFFF', trim: '#041E42', face: 'modern' },
    LAK: { fill: '#111111', num: '#FFFFFF', trim: '#A2AAAD', face: 'block' },
    MIN: { fill: '#154734', num: '#EDDCB2', trim: '#A6192E', face: 'varsity' },
    MTL: { fill: '#AF1E2D', num: '#FFFFFF', trim: '#192168', face: 'block' },
    NJD: { fill: '#CE1126', num: '#FFFFFF', trim: '#111111', face: 'block' },
    NSH: { fill: '#FFB81C', num: '#041E42', trim: '#FFFFFF', face: 'modern' },
    NYI: { fill: '#00539B', num: '#F47D30', trim: '#FFFFFF', face: 'varsity' },
    NYR: { fill: '#0038A8', num: '#CE1126', trim: '#FFFFFF', face: 'varsity' },
    OTT: { fill: '#111111', num: '#C52032', trim: '#C2912C', face: 'block' },
    PHI: { fill: '#F74902', num: '#FFFFFF', trim: '#111111', face: 'block' },
    PIT: { fill: '#111111', num: '#FCB514', trim: '#FFFFFF', face: 'block' },
    SEA: { fill: '#001628', num: '#99D9D9', trim: '#E9072B', face: 'modern' },
    SJS: { fill: '#006D75', num: '#FFFFFF', trim: '#111111', face: 'modern' },
    STL: { fill: '#002F87', num: '#FFFFFF', trim: '#FCB514', face: 'block' },
    TBL: { fill: '#002868', num: '#FFFFFF', trim: null, face: 'modern' },
    TOR: { fill: '#00205B', num: '#FFFFFF', trim: null, face: 'block' },
    UTA: { fill: '#111111', num: '#FFFFFF', trim: '#69B3E7', face: 'modern' },
    VAN: { fill: '#00205B', num: '#FFFFFF', trim: '#00843D', face: 'block' },
    VGK: { fill: '#333F48', num: '#B4975A', trim: '#111111', face: 'modern' },
    WPG: { fill: '#041E42', num: '#FFFFFF', trim: '#AC162C', face: 'modern' },
    WSH: { fill: '#C8102E', num: '#FFFFFF', trim: '#041E42', face: 'block' },
};

const FALLBACK: Sweater = { fill: '#23405F', num: '#FFFFFF', trim: null, face: 'block' };

/**
 * A sweater-coloured disc with the player's number in the club's number
 * colour and trim. `ring` is the side colour on the page, so dark sweaters
 * (navy, black) still separate from the dark ground.
 */
export function JerseyNumber({ tri, num, ring, size = 34, title }: { tri: string; num: number | null; ring: string; size?: number; title?: string }) {
    const s = SWEATERS[tri] ?? FALLBACK;
    const face = FACES[s.face];
    const text = num != null ? String(num) : '–';
    const fs = size * face.scale * (text.length > 1 ? 1 : 1.12);
    return (
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="block shrink-0" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
            <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={s.fill} stroke={ring} strokeWidth={2} />
            <text
                x={size / 2}
                y={size / 2}
                dy="0.36em"
                textAnchor="middle"
                fontFamily={face.family}
                fontSize={fs}
                fill={s.num}
                stroke={s.trim ?? 'none'}
                strokeWidth={s.trim ? Math.max(1.5, size / 16) : 0}
                strokeLinejoin="round"
                paintOrder="stroke"
                letterSpacing={-0.5}
            >
                {text}
            </text>
        </svg>
    );
}
