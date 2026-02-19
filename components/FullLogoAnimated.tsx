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
            // 1. Setup Filters & Puck
            const defs = svg.querySelector('defs') || document.createElementNS("http://www.w3.org/2000/svg", "defs");
            if (!svg.querySelector('#liquidFilter')) {
                defs.innerHTML += `
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
            }

            // Create puck if not exists
            if (!svg.querySelector('#puck')) {
                const puck = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                puck.setAttribute('id', 'puck');
                puck.setAttribute('r', '8');
                puck.setAttribute('fill', '#111');
                puck.setAttribute('stroke', '#4FF5F7');
                puck.setAttribute('stroke-width', '1');
                // Center the puck initially far left, vertically aligned with 'G' (approx y=120)
                puck.setAttribute('cx', '-20');
                puck.setAttribute('cy', '125');
                svg.appendChild(puck);
            }

            const puck = svg.querySelector('#puck');

            // 2. Identify Parts
            // Only affect the text paths (ignore horse, ignore goal light groups)
            const paths = Array.from(svg.querySelectorAll('path'));
            const textPaths = paths.filter(p => {
                const fill = p.getAttribute('fill') || '';
                if (fill.includes('#4FF5F7') || fill.includes('#198081') || fill.includes('#FF0000')) return false;
                if (p.closest && (p.closest('#goal-light-base') || p.closest('#goal-light-glow'))) return false;
                return true;
            });

            // 3. Set Initial State
            // Apply liquid filter to text only
            textPaths.forEach(p => {
                p.style.filter = 'url(#liquidFilter)';
                p.style.opacity = '0';
            });

            // Initial clip - hide text part (approx right 55% of SVG)
            gsap.set(container.current, { clipPath: 'inset(0 55% 0 0)' });

            const redLight = svg.querySelector('#red-light');
            if (redLight) {
                gsap.set(redLight, { opacity: 0 }); // Off initially
            }

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
                .to(textPaths, {
                    opacity: 1,
                    duration: 0.5,
                    stagger: 0.05,
                    ease: "power2.out"
                }, "-=1.0")

                // Animate turbulence (liquid forming effect)
                .fromTo(svg.querySelectorAll('feDisplacementMap'),
                    { attr: { scale: 20 } },
                    { attr: { scale: 0 }, duration: 1.2, ease: "elastic.out(1, 0.5)" },
                    "-=1.2"
                );

            // Step 3: Shoot the Puck!
            if (puck) {
                tl.to(puck, {
                    attr: { cx: 540 }, // Inside the 'G'
                    duration: 0.6,
                    ease: "power2.in",
                }, "-=0.2")
                    // Puck bouncing inside the net a little bit
                    .to(puck, {
                        attr: { cx: 550 },
                        duration: 0.15,
                        ease: "power1.out",
                        yoyo: true,
                        repeat: 1
                    });
            }

            // Step 4: Turn on Goal Light and Rotate
            if (redLight) {
                tl.to(redLight, {
                    opacity: 1,
                    duration: 0.1,
                }, "-=0.3"); // Turns on right as puck enters

                // Apply gradient rotation animation
                redLight.setAttribute('fill', 'url(#goalLightGradient)');
                const gradient = svg.querySelector('#goalLightGradient');

                if (gradient) {
                    gsap.fromTo(gradient,
                        { attr: { x1: "-100%", x2: "0%" } },
                        {
                            attr: { x1: "100%", x2: "200%" },
                            duration: 1.0,
                            repeat: -1,
                            ease: "linear",
                            delay: tl.duration() - 0.3 // start rotating immediately
                        }
                    );
                }

                // Add an oscillating glowing pulse
                gsap.to(redLight, {
                    opacity: 0.6,
                    duration: 0.15,
                    yoyo: true,
                    repeat: -1,
                    ease: "sine.inOut",
                    delay: tl.duration() - 0.3
                });
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
