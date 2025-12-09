'use client';

import { useRef, useState, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

interface FullLogoAnimatedProps {
    className?: string;
}

export default function FullLogoAnimated({ className }: FullLogoAnimatedProps) {
    const container = useRef<HTMLDivElement>(null);
    const [svgContent, setSvgContent] = useState<string | null>(null);

    useEffect(() => {
        fetch('/ponyxG_full.svg')
            .then(async (res) => {
                if (res.ok) {
                    const text = await res.text();
                    if (text.includes('<svg')) {
                        setSvgContent(text);
                    }
                }
            })
            .catch((err) => console.warn('Failed to load full logo', err));
    }, []);

    useGSAP(() => {
        if (!container.current || !svgContent) return;

        const svgElement = container.current.querySelector('svg');
        if (svgElement) {
            // Ensure SVG scales correctly
            svgElement.setAttribute('width', '100%');
            svgElement.setAttribute('height', '100%');

            const paths = svgElement.querySelectorAll('path');
            if (paths.length > 0) {
                // Prepare paths for line drawing
                paths.forEach((path) => {
                    const length = path.getTotalLength();
                    // Set initial styles for animation
                    path.style.stroke = 'rgba(255,255,255,0.5)'; // Subtle white outline
                    path.style.strokeWidth = '2px';
                    path.style.strokeDasharray = `${length}`;
                    path.style.strokeDashoffset = `${length}`;
                    path.style.fillOpacity = '0'; // Hide fill initially
                });

                const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });

                // Animate stroke (draw)
                tl.to(paths, {
                    strokeDashoffset: 0,
                    duration: 2.5,
                    stagger: 0.1
                })
                    // Fade in fill and remove stroke
                    .to(paths, {
                        fillOpacity: 1,
                        strokeOpacity: 0,
                        duration: 1
                    }, "-=1.0"); // Overlap slightly
            } else {
                // Fallback fade in if no paths
                gsap.fromTo(svgElement, { opacity: 0 }, { opacity: 1, duration: 1 });
            }
        }
    }, { dependencies: [svgContent], scope: container });

    return (
        <div
            ref={container}
            className={`relative ${className}`}
            style={{ width: '100%', height: 'auto' }} // Ensure container is responsive
        >
            {svgContent ? (
                <div
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                    className="w-full h-full"
                />
            ) : (
                // Spacer/Placeholder to prevent layout shift before load
                <div className="w-full pb-[30%]" />
            )}
        </div>
    );
}
