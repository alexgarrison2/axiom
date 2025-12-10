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

export default function LogoDisplay({ src, alt, triCode, className, primaryColor }: LogoDisplayProps) {
    const container = useRef<HTMLDivElement>(null);
    const [svgContent, setSvgContent] = useState<string | null>(null);

    // Fetch SVG if triCode is present
    useEffect(() => {
        if (!triCode) return;
        fetch(`/logos/${triCode}.svg`)
            .then(async (res) => {
                if (res.ok) {
                    const text = await res.text();
                    // Ensure it's an SVG
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

        // Existing SVG Path Animation (DrawSVG)
        if (svgContent) {
            const svgElement = container.current.querySelector('svg');
            if (svgElement) {
                const paths = svgElement.querySelectorAll('path');
                if (paths.length > 0) {
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
                } else {
                    gsap.fromTo(svgElement,
                        { scale: 0.8, opacity: 0 },
                        { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.4)", transformOrigin: "center center" }
                    );
                }
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
