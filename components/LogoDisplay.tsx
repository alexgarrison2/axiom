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
    triCode?: string;
    className?: string;
    mdSize?: number;
}

export default function LogoDisplay({ src, alt, triCode, className }: LogoDisplayProps) {
    const container = useRef<HTMLDivElement>(null);
    const [svgContent, setSvgContent] = useState<string | null>(null);

    // Fetch SVG if triCode is present
    useEffect(() => {
        if (!triCode) return;
        fetch(`/logos/${triCode}.svg`)
            .then(async (res) => {
                if (res.ok) {
                    const text = await res.text();
                    // Basic sanity check to ensure it's an SVG
                    if (text.includes('<svg')) {
                        setSvgContent(text);
                    }
                }
            })
            .catch((err) => console.warn(`Failed to load logo for ${triCode}`, err));
    }, [triCode]);

    // Animate SVG paths on load
    useGSAP(() => {
        if (svgContent && container.current) {
            const svgElement = container.current.querySelector('svg');
            if (!svgElement) return;

            const paths = svgElement.querySelectorAll('path');

            if (paths.length > 0) {
                // Prepare paths for "DrawSVG" effect
                paths.forEach((path) => {
                    const length = path.getTotalLength();
                    // Set stroke properties manually to mimic DrawSVG
                    path.style.stroke = 'rgba(255,255,255,0.8)';
                    path.style.strokeWidth = '1px';
                    path.style.strokeDasharray = `${length}`;
                    path.style.strokeDashoffset = `${length}`;
                    path.style.fillOpacity = '0'; // Hide fill initially
                });

                const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });

                // 1. Draw the strokes
                tl.to(paths, {
                    strokeDashoffset: 0,
                    duration: 1.5,
                    stagger: 0.05
                })
                    // 2. Fade in fill and remove stroke
                    .to(paths, {
                        fillOpacity: 1,
                        strokeOpacity: 0,
                        duration: 0.8
                    }, "-=0.5");

            } else {
                // Fallback for simple SVGs (e.g., those without paths, like some logos)
                gsap.fromTo(svgElement,
                    { scale: 0.8, opacity: 0 },
                    { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.4)", transformOrigin: "center center" }
                );
            }
        }
    }, { dependencies: [svgContent], scope: container });

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
            {svgContent ? (
                <div
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                    className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:drop-shadow-sm"
                />
            ) : (
                <Image
                    src={src}
                    alt={alt}
                    fill
                    className="object-contain"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                />
            )}
        </motion.div>
    );
}
