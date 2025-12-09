'use client';

import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

interface LogoDisplayProps {
    src: string;
    alt: string;
    isProjectedWinner?: boolean;
    teamColor?: string;
}

export default function LogoDisplay({ src, alt, triCode, className, isProjectedWinner, teamColor = '#ffffff' }: LogoDisplayProps) {
    const container = useRef<HTMLDivElement>(null);
    const glowRef = useRef<SVGRectElement>(null);
    const [svgContent, setSvgContent] = useState<string | null>(null);

    // Fetch SVG if triCode is present
    useEffect(() => {
        if (!triCode) return;
        fetch(`/logos/${triCode}.svg`)
            .then(async (res) => {
                if (res.ok) {
                    const text = await res.text();
                    if (text.includes('<svg')) {
                        setSvgContent(text);
                    }
                }
            })
            .catch((err) => console.warn(`Failed to load logo for ${triCode}`, err));
    }, [triCode]);

    // Animate SVG paths on load
    useGSAP(() => {
        if (!container.current) return;

        // 1. Existing SVG Path Animation (DrawSVG)
        if (svgContent) {
            const svgElement = container.current.querySelector('svg');
            if (svgElement) {
                const paths = svgElement.querySelectorAll('path');
                if (paths.length > 0) {
                    paths.forEach((path) => {
                        const length = path.getTotalLength();
                        path.style.stroke = 'rgba(255,255,255,0.8)';
                        path.style.strokeWidth = '1px';
                        path.style.strokeDasharray = `${length}`;
                        path.style.strokeDashoffset = `${length}`;
                        path.style.fillOpacity = '0';
                    });

                    const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });
                    tl.to(paths, { strokeDashoffset: 0, duration: 1.5, stagger: 0.05 })
                        .to(paths, { fillOpacity: 1, strokeOpacity: 0, duration: 0.8 }, "-=0.5");
                } else {
                    gsap.fromTo(svgElement,
                        { scale: 0.8, opacity: 0 },
                        { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.4)", transformOrigin: "center center" }
                    );
                }
            }
        }

        // 2. Projected Winner Orbital Glow
        if (isProjectedWinner && glowRef.current) {
            // Kill any existing tweens to prevent stacking if props change quickly
            gsap.killTweensOf(glowRef.current);

            // Orbit Animation
            gsap.to(glowRef.current, {
                strokeDashoffset: -200, // Move the dash pattern
                duration: 3,
                ease: "none",
                repeat: -1
            });

            // Pulse Opacity
            gsap.fromTo(glowRef.current,
                { opacity: 0.6 },
                { opacity: 1, duration: 1.5, yoyo: true, repeat: -1, ease: "sine.inOut" }
            );
        }

    }, { dependencies: [svgContent, isProjectedWinner], scope: container });

    return (
        <motion.div
            ref={container}
            className={`relative drop-shadow-lg ${className} flex items-center justify-center`}
            whileHover={{
                scale: 1.15,
                rotate: 2,
                filter: "drop-shadow(0 0 15px rgba(255,255,255,0.4))"
            }}
            whileTap={{ scale: 0.95 }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{
                scale: 1,
                opacity: 1,
                transition: { type: "spring", stiffness: 200, damping: 12 }
            }}
        >
            {/* Winner Glow Overlay */}
            {isProjectedWinner && (
                <svg className="absolute inset-[-20%] w-[140%] h-[140%] pointer-events-none z-0 overflow-visible">
                    <defs>
                        <filter id="glow-blur" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    <rect
                        ref={glowRef}
                        x="10%" y="10%" width="80%" height="80%" rx="50%" ry="50%"
                        fill="none"
                        stroke={teamColor}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="20 180" // Create the "comet" look (short dash, long gap)
                        filter="url(#glow-blur)"
                        className="opacity-80"
                    />
                </svg>
            )}

            {svgContent ? (
                <div
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                    className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:drop-shadow-sm relative z-10"
                />
            ) : src ? (
                <Image
                    src={src}
                    alt={alt}
                    fill
                    className="object-contain relative z-10"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                />
            ) : (
                <div className="w-full h-full bg-neutral-800/50 rounded-full flex items-center justify-center relative z-10">
                    <span className="text-[8px] text-neutral-500 font-bold">?</span>
                </div>
            )}
        </motion.div>
    );
}
