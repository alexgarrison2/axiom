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
            // Target all common shapes
            const shapes = container.current.querySelectorAll('path, circle, rect, ellipse, polygon, polyline');
            if (shapes.length > 0) {
                gsap.fromTo(shapes,
                    {
                        scale: 0,
                        opacity: 0,
                        transformOrigin: "center center"
                    },
                    {
                        scale: 1,
                        opacity: 1,
                        stagger: { amount: 0.6, from: "center" },
                        duration: 0.8,
                        ease: "back.out(1.4)"
                    }
                );
            } else {
                // Fallback for SVGs without discrete shapes
                gsap.fromTo("svg",
                    { scale: 0.5, opacity: 0 },
                    { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.4)" }
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
