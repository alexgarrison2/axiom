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
            // 1. Setup Filters & Gradients
            const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            defs.innerHTML = `
                <filter id="liquidFilter">
                    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="turbulence" />
                    <feDisplacementMap in2="turbulence" in="SourceGraphic" scale="0" xChannelSelector="R" yChannelSelector="G" />
                </filter>
                <linearGradient id="goalLightGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#FF0000" />
                    <stop offset="50%" stop-color="#FFCCCC" />
                    <stop offset="100%" stop-color="#FF0000" />
                </linearGradient>
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
                // If it's the goal light (Red), skip the liquid filter
                if (p.getAttribute('fill') === '#FF0000') return;

                p.style.filter = 'url(#liquidFilter)';
                p.style.opacity = '0';
            });

            // Initial clip - hide text part (approx right 55% of SVG)
            gsap.set(container.current, { clipPath: 'inset(0 55% 0 0)' });

            const tl = gsap.timeline({
                defaults: { ease: "power3.inOut" },
                onComplete: () => {
                    if (container.current) {
                        container.current.style.overflow = 'visible'; // Allow glows to spill out
                    }
                }
            });

            // 4. Animation Sequence

            // Step 1: Expand Container (Reveal space for text)
            tl.to(container.current, {
                clipPath: 'inset(0 0% 0 0)',
                duration: 1.5,
                ease: "power2.inOut"
            })

                // Step 2: "Morph/Liquid" form the text
                .to(textPaths.filter(p => p.getAttribute('fill') !== '#FF0000'), {
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

            // Animate Goal Light (Rotating Effect)
            const goalLight = svg.querySelector('path[fill="#FF0000"]');
            if (goalLight) {
                // Use the gradient
                goalLight.setAttribute('fill', 'url(#goalLightGradient)');

                // Animate the gradient to simulate rotation
                // We access the gradient element directly
                const gradient = svg.querySelector('#goalLightGradient');
                if (gradient) {
                    gsap.to(gradient, {
                        attr: { x1: "100%", x2: "200%" }, // Move window across
                        duration: 1.0,
                        repeat: -1,
                        ease: "linear",
                        modifiers: {
                            attr: (val: any) => {
                                // Reset mechanism not needed if we sweep correctly, or just use repeat
                                // Actually, standard gradient loop:
                                return val;
                            }
                        }
                    });

                    // Better loop strategy for linear gradient:
                    gsap.fromTo(gradient,
                        { attr: { x1: "-100%", x2: "0%" } },
                        {
                            attr: { x1: "100%", x2: "200%" },
                            duration: 1.5,
                            repeat: -1,
                            ease: "linear"
                        }
                    );
                }

                // Subtle glow (filter)
                gsap.set(goalLight, { filter: 'drop-shadow(0 0 5px #FF0000)' });
            }
        }
    }, { dependencies: [svgContent], scope: container });

    return (
        <div
            ref={container}
            className={`relative ${className}`}
            style={{ width: '100%', height: 'auto', overflow: 'hidden' }}
        >
            {svgContent ? (
                <div
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                    className="w-full h-full [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
                />
            ) : (
                <div className="w-full pb-[30%]" />
            )}
        </div>
    );
}
