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

        const svg = container.current.querySelector('svg');
        if (svg) {
            // 1. Setup Filters
            const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            defs.innerHTML = `
                <filter id="liquidFilter">
                    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="turbulence" />
                    <feDisplacementMap in2="turbulence" in="SourceGraphic" scale="0" xChannelSelector="R" yChannelSelector="G" />
                </filter>
            `;
            svg.prepend(defs);

            // 2. Identify Parts
            // The "Pony" is paths 1 & 2 (Cyan/Teal). The Text is the white paths (subsequent paths).
            const paths = Array.from(svg.querySelectorAll('path'));
            const ponyPaths = paths.slice(0, 2);
            const textPaths = paths.slice(2);

            // 3. Set Initial State
            // Group text paths for animation
            textPaths.forEach(p => {
                p.style.filter = 'url(#liquidFilter)';
                p.style.opacity = '0';
            });

            // Initial clip - hide text part (approx right 55% of SVG)
            // Pony is roughly 260px of 573px total ~ 45%
            gsap.set(container.current, { clipPath: 'inset(0 55% 0 0)' });

            const tl = gsap.timeline({ defaults: { ease: "power3.inOut" } });

            // 4. Animation Sequence

            // Step 1: Expand Container (Reveal space for text)
            tl.to(container.current, {
                clipPath: 'inset(0 0% 0 0)',
                duration: 1.5,
                ease: "power2.inOut"
            })

                // Step 2: "Morph/Liquid" form the text
                .to(textPaths, {
                    opacity: 1,
                    duration: 0.5,
                    stagger: 0.05,
                    ease: "power2.out"
                }, "-=1.0") // Start appearing while expanding

                // Animate turbulence (liquid forming effect)
                .fromTo(svg.querySelectorAll('feDisplacementMap'),
                    { attr: { scale: 20 } },
                    { attr: { scale: 0 }, duration: 1.2, ease: "elastic.out(1, 0.5)" },
                    "-=1.2"
                );
        }
    }, { dependencies: [svgContent], scope: container });

    return (
        <div
            ref={container}
            className={`relative ${className} [&>svg]:w-full [&>svg]:h-auto [&>svg]:block`}
            style={{ width: '100%', height: 'auto', overflow: 'hidden' }}
        >
            {svgContent ? (
                <div
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                    className="w-full h-full"
                />
            ) : (
                <div className="w-full pb-[30%]" />
            )}
        </div>
    );
}
