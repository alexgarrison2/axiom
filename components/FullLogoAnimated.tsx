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

            // Clear previous puck if exists (hot reload safety)
            const oldPuck = svg.querySelector('#puck-group');
            if (oldPuck) oldPuck.remove();
            const legacyPuck = svg.querySelector('#puck');
            if (legacyPuck) legacyPuck.remove();

            // Create puck group
            const puckGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
            puckGroup.setAttribute('id', 'puck-group');

            // Puck body (gives it 3D thickness)
            const body = document.createElementNS("http://www.w3.org/2000/svg", "path");
            // A cylinder body: left edge down, bottom curve, right edge up
            body.setAttribute('d', 'M-8,0 l0,4 a8,3 0 0,0 16,0 l0,-4 Z');
            body.setAttribute('fill', '#222');
            body.setAttribute('stroke', '#4FF5F7');
            body.setAttribute('stroke-width', '0.5');

            // Puck top (ellipse)
            const top = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
            top.setAttribute('cx', '0');
            top.setAttribute('cy', '0');
            top.setAttribute('rx', '8');
            top.setAttribute('ry', '3');
            top.setAttribute('fill', '#0a0a0a');
            top.setAttribute('stroke', '#4FF5F7');
            top.setAttribute('stroke-width', '1');

            puckGroup.appendChild(body);
            puckGroup.appendChild(top);
            svg.appendChild(puckGroup);

            // Set initial state
            gsap.set(puckGroup, { opacity: 0, x: -50, y: 118, transformOrigin: '50% 50%' });

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
            const goalLightBase = svg.querySelector('#goal-light-base');
            const goalLightGlow = svg.querySelector('#goal-light-glow');

            if (redLight) gsap.set(redLight, { opacity: 0 }); // Off initially
            if (goalLightBase) gsap.set(goalLightBase, { opacity: 0.1 }); // Almost invisible initially
            if (goalLightGlow) gsap.set(goalLightGlow, { opacity: 0.1 }); // Almost invisible initially

            const tl = gsap.timeline({
                defaults: { ease: "power3.inOut" }
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
            tl.addLabel("readyToShoot", "-=0.2");

            tl.to(puckGroup, {
                opacity: 1,
                duration: 0.01
            }, "readyToShoot");

            tl.fromTo(puckGroup,
                { x: -50, y: 118, rotation: 0, scale: 1 },
                {
                    x: 543,
                    y: 118,
                    rotation: -1080, // Tumble
                    duration: 0.6,
                    ease: "power2.in"
                },
                "readyToShoot"
            );

            tl.addLabel("puckInNet");

            // Bounce in net
            tl.to(puckGroup, { x: 550, rotation: -1100, duration: 0.1, ease: "power1.out" }, "puckInNet")
                .to(puckGroup, { x: 545, rotation: -1090, duration: 0.1, ease: "power1.in" })
                // Disappear 1.5s later
                .to(puckGroup, { opacity: 0, duration: 0.3 }, "puckInNet+=1.5");

            // Step 4: Turn on Goal Light and Rotate
            // Remove clipping box so glows spill freely
            tl.set(container.current, { clipPath: 'none', overflow: 'visible' }, "puckInNet");

            if (goalLightBase) tl.to(goalLightBase, { opacity: 1, duration: 0.1 }, "puckInNet");
            if (goalLightGlow) tl.to(goalLightGlow, { opacity: 1, duration: 0.1 }, "puckInNet");

            if (redLight) {
                // Turns on exactly when puck arrives
                tl.to(redLight, {
                    opacity: 1,
                    duration: 0.1,
                }, "puckInNet");

                // Apply gradient rotation animation
                redLight.setAttribute('fill', 'url(#goalLightGradient)');
                const gradient = svg.querySelector('#goalLightGradient');

                if (gradient) {
                    tl.fromTo(gradient,
                        { attr: { x1: "-100%", x2: "0%" } },
                        {
                            attr: { x1: "100%", x2: "200%" },
                            duration: 1.0,
                            repeat: -1,
                            ease: "linear"
                        }, "puckInNet"
                    );
                }

                // Add an oscillating glowing pulse
                tl.to(redLight, {
                    opacity: 0.6,
                    duration: 0.15,
                    yoyo: true,
                    repeat: -1,
                    ease: "sine.inOut"
                }, "puckInNet");
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
