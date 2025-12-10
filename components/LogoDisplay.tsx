'use client';

import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

// ... (we are replacing the whole component logic essentially to strip the glow)
// Actually standard replacement for the props and the effect hook should be enough.

interface LogoDisplayProps {
    src: string;
    alt: string;
    triCode?: string;
    className?: string;
    primaryColor?: string;
    variant?: 'standard' | 'animated';
}

function isColorDark(color: string): boolean {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    // Standard luminance formula
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance < 40; // Threshold for "very dark"
}

export default function LogoDisplay({ src, alt, triCode, className, primaryColor, variant = 'standard' }: LogoDisplayProps) {
    const container = useRef<HTMLDivElement>(null);
    const [svgContent, setSvgContent] = useState<string | null>(null);

    // If variant is standard, just use the provided src (which points to standard logo url)
    // Or if src is missing but triCode exists, point to local standard logos
    const imageSrc = variant === 'standard' && triCode ? `/logos/${triCode}.svg` : src;

    // Fetch Animated SVG if variant is 'animated'
    useEffect(() => {
        if (variant !== 'animated' || !triCode) return;

        // Fetch from the new animated logos directory
        fetch(`/logos-animated/${triCode}.svg`)
            .then(async (res) => {
                if (res.ok) {
                    const text = await res.text();
                    // Ensure it's an SVG
                    if (text.includes('<svg')) {
                        setSvgContent(text);
                    }
                }
            })
            .catch((err) => console.warn(`Failed to load animated logo for ${triCode}`, err));
    }, [triCode, variant]);

    // Animate SVG paths (Only for 'animated' variant)
    useGSAP(() => {
        if (variant !== 'animated' || !container.current) return;

        if (svgContent) {
            const svgElement = container.current.querySelector('svg');

            if (svgElement) {
                // Hybrid Animation Strategy
                // 1. "Heavy" Elements (Filters, Images): Fade In (Low Cost)
                // 2. "Clean" Vectors (Paths): Draw In (High Polish)

                // Find all elements that cause performance issues (Filters, Images)
                // We assume these are the "texture" or "background" layers
                const heavyElements = Array.from(svgElement.querySelectorAll('[filter], image, defs > pattern'));

                // Find all paths that represent the clean line art
                // Exclude paths that are inside a heavy element (filtered group) to avoid lag
                const allPaths = Array.from(svgElement.querySelectorAll('path'));
                const cleanPaths = allPaths.filter(path => {
                    const parentFilter = path.closest('[filter]');
                    const hasFilter = path.hasAttribute('filter');
                    // Only animate paths that aren't filtered (or inside a filter)
                    return !parentFilter && !hasFilter;
                });

                // Helper: Animate Heavy Elements (Fade In)
                // If there are heavy elements, fade them in immediately or with slight delay
                if (heavyElements.length > 0) {
                    gsap.fromTo(heavyElements,
                        { opacity: 0, scale: 0.95 },
                        { opacity: 1, scale: 1, duration: 0.8, ease: "power2.out", stagger: 0.1 }
                    );
                }

                // Helper: Animate Clean Paths (Draw In)
                if (cleanPaths.length > 0) {
                    // Determine stroke color
                    let strokeColor = 'rgba(255,255,255,0.8)';
                    if (primaryColor && !isColorDark(primaryColor)) {
                        strokeColor = primaryColor;
                    }

                    cleanPaths.forEach((path) => {
                        const length = path.getTotalLength();
                        path.style.stroke = strokeColor;
                        path.style.strokeWidth = '0.3px';
                        path.style.strokeDasharray = `${length}`;
                        path.style.strokeDashoffset = `${length}`;
                        path.style.fillOpacity = '0';
                    });

                    const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
                    tl.to(cleanPaths, { strokeDashoffset: 0, duration: 1.5, stagger: 0.05 })
                        .to(cleanPaths, { fillOpacity: 1, strokeOpacity: 0, duration: 0.8 }, "-=0.5");
                }

                // Fallback: If absolutely nothing was found to animate (weird edge case), fade whole SVG
                if (heavyElements.length === 0 && cleanPaths.length === 0) {
                    gsap.fromTo(svgElement,
                        { scale: 0.8, opacity: 0 },
                        { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.4)", transformOrigin: "center center" }
                    );
                }
            }
        }
    }, { dependencies: [svgContent, variant], scope: container });

    // Standard Render (Image)
    if (variant === 'standard') {
        return (
            <div className={`relative ${className}`}>
                <Image
                    src={imageSrc}
                    alt={alt}
                    fill
                    className="object-contain"
                />
            </div>
        );
    }

    // Animated Render (SVG)
    return (
        <div
            ref={container}
            className={`relative flex items-center justify-center ${className}`}
        >
            {svgContent ? (
                <div
                    className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:overflow-visible"
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center">
                    <div className="relative w-full h-full">
                        <Image
                            src={imageSrc || src}
                            alt={alt}
                            fill
                            className="object-contain opacity-50"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
