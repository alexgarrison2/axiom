import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Pony xG · NHL predictions',
        short_name: 'Pony xG',
        description: "Tonight's NHL games with expected-goals win probabilities, compared with the betting market.",
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#05070B',
        theme_color: '#05070B',
        categories: ['sports', 'news'],
        icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
            { name: 'Tonight', url: '/' },
            { name: 'Teams', url: '/teams' },
            { name: 'Accuracy', url: '/accuracy' },
        ],
    };
}
