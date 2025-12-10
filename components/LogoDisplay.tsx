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

        // Existing SVG Path Animation (DrawSVG)
        if (svgContent) {
            const svgElement = container.current.querySelector('svg');

            // Performance Check: logical heuristic to skip expensive path animation
            // 1. If file size is massive (>50KB string length approx)
            // 2. If it contains embedded images (base64) which implies it's not a pure vector
            // 3. If path count is too high (>50)
            const isHeavy = svgContent.length > 50000 || svgContent.includes('data:image');
            const paths = svgElement ? svgElement.querySelectorAll('path') : [];

            if (svgElement && !isHeavy && paths.length > 0 && paths.length < 50) {
                // Determine stroke color
                let strokeColor = 'rgba(255,255,255,0.8)';
                if (primaryColor && !isColorDark(primaryColor)) {
                    strokeColor = primaryColor;
                }

                paths.forEach((path) => {
                    const length = path.getTotalLength();
                    path.style.stroke = strokeColor;
                    path.style.strokeWidth = '0.3px';
                    path.style.strokeDasharray = `${length}`;
                    path.style.strokeDashoffset = `${length}`;
                    path.style.fillOpacity = '0';
                });

                const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
                tl.to(paths, { strokeDashoffset: 0, duration: 1.5, stagger: 0.05 })
                    .to(paths, { fillOpacity: 1, strokeOpacity: 0, duration: 0.8 }, "-=0.5");
            } else if (svgElement) {
                // Fallback for heavy SVGs or those without paths: Simple Fade In
                // This prevents choking on massive base64 strings or 1000s of grunge paths
                gsap.fromTo(svgElement,
                    { scale: 0.8, opacity: 0 },
                    { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.4)", transformOrigin: "center center" }
                );
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
