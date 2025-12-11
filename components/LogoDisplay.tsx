'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

interface LogoDisplayProps {
    src: string;
    alt: string;
    triCode?: string;
    className?: string;
    primaryColor?: string;
    variant?: 'standard' | 'animated';
}

export default function LogoDisplay({ src, alt, triCode, className, primaryColor, variant = 'standard' }: LogoDisplayProps) {
    // SJS SPECIAL TEST: Composite Animation
    // For SJS, we load _bg (Static) + Normal (Animated Line Draw)
    const isSJS = triCode === 'SJS';
    const container = useRef<HTMLDivElement>(null);
    const [svgContent, setSvgContent] = useState<string | null>(null);

    // Fetch inline SVG for SJS foreground
    useEffect(() => {
        if (isSJS) {
            fetch('/logos/SJS.svg')
                .then(res => res.text())
                .then(text => {
                    if (text.includes('<svg')) setSvgContent(text);
                })
                .catch(err => console.error('Failed to load SJS svg', err));
        }
    }, [isSJS]);

    useGSAP(() => {
        if (!isSJS || !container.current || !svgContent) return;

        const svg = container.current.querySelector('svg.sjs-foreground');
        if (svg) {
            const paths = svg.querySelectorAll('path, polygon, polyline, rect, circle, ellipse');

            // Prepare paths for "Line Draw"
            paths.forEach((p) => {
                const pathEl = p as SVGPathElement;
                const length = pathEl.getTotalLength ? pathEl.getTotalLength() : 1000;

                // FORCE STROKE: Use Primary Color and Thin Line (0.3px)
                const originalFill = pathEl.getAttribute('fill') || '#FFFFFF';
                // Use primaryColor prop if available, otherwise default or white
                const strokeColor = primaryColor || '#FFFFFF';

                pathEl.style.fill = 'none';
                pathEl.style.stroke = strokeColor;
                pathEl.style.strokeWidth = '0.3px'; // Thin line as requested
                pathEl.style.strokeLinecap = 'round';
                pathEl.style.strokeLinejoin = 'round';

                pathEl.style.strokeDasharray = `${length}`;
                pathEl.style.strokeDashoffset = `${length}`;
                pathEl.style.opacity = '1';

                // Store original fill for later restoration
                pathEl.dataset.originalFill = originalFill;
            });

            gsap.to(paths, {
                strokeDashoffset: 0,
                duration: 2.0,
                ease: "power2.out",
                stagger: {
                    amount: 0.8,
                    from: "random"
                }
            });

            // Fade in Fill + Fade out Stroke (to return to "Normal" look)
            gsap.to(paths, {
                fill: (i, t) => t.dataset.originalFill, // Update CSS style.fill directly (overriding 'none')
                fillOpacity: 1,
                strokeOpacity: 0, // Fade out the temporary strokes
                duration: 1.0,
                delay: 1.8,
                ease: "power2.inOut"
            });
        }
    }, { dependencies: [isSJS, svgContent], scope: container });


    // Standard Logic for non-SJS
    const imageSrc = triCode ? `/logos/${triCode}.svg` : src;

    if (isSJS) {
        return (
            <div ref={container} className={`relative ${className}`}>
                {/* Background Layer (Static) */}
                <Image
                    src="/logos/SJS_bg.svg"
                    alt={`${alt} Background`}
                    fill
                    className="object-contain" // User requested normal load behind
                    priority={true}
                />

                {/* Foreground Layer (Animated SVG) */}
                {svgContent ? (
                    <div
                        className="absolute inset-0 w-full h-full z-10"
                        dangerouslySetInnerHTML={{ __html: svgContent.replace('<svg', '<svg class="sjs-foreground" style="width:100%;height:100%"') }}
                    />
                ) : (
                    // Fallback while loading
                    <Image
                        src="/logos/SJS.svg"
                        alt={alt}
                        fill
                        className="object-contain z-10"
                    />
                )}
            </div>
        );
    }

    return (
        <div className={`relative ${className}`}>
            <Image
                src={imageSrc}
                alt={alt}
                fill
                className="object-contain"
                priority={true}
            />
        </div>
    );
}
