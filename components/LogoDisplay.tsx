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

                pathEl.style.strokeDasharray = `${length}`;
                pathEl.style.strokeDashoffset = `${length}`;
                pathEl.style.opacity = '1';
                // Ensure stroke is visible (some logos rely on fill only)
                // For "Line Draw", we usually need stroke.
                // Assuming the user's SJS.svg is prepared for this (has strokes).
            });

            gsap.to(paths, {
                strokeDashoffset: 0,
                duration: 2.5,
                ease: "power2.out",
                stagger: {
                    amount: 0.5,
                    from: "random"
                }
            });

            // Optional: Fade in fill after lines
            gsap.fromTo(paths,
                { fillOpacity: 0 },
                { fillOpacity: 1, duration: 1, delay: 2 }
            );
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
