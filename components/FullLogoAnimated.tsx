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

        const wrapper = container.current.querySelector('.logo-wrapper');
        const beam = container.current.querySelector('.scan-beam');

        if (wrapper && beam) {
            const tl = gsap.timeline({ defaults: { ease: "power2.inOut" } });

            // Set initial states
            gsap.set(wrapper, { clipPath: 'inset(0 100% 0 0)' });
            gsap.set(beam, { xPercent: -100, opacity: 1 });

            // Create the wiping reveal
            tl.to(wrapper, {
                clipPath: 'inset(0 0% 0 0)',
                duration: 1.2,
                ease: "power3.inOut"
            })
                .to(beam, {
                    left: '100%',
                    duration: 1.2,
                    ease: "power3.inOut"
                }, "<")
                .to(beam, {
                    opacity: 0,
                    duration: 0.2
                });

            // Add a subtle scale pop at the end for extra dynamism
            tl.from(wrapper, {
                scale: 1.05,
                duration: 1.5,
                ease: "elastic.out(1, 0.75)"
            }, 0);
        }
    }, { dependencies: [svgContent], scope: container });

    return (
        <div
            ref={container}
            className={`relative ${className}`}
            style={{ width: '100%', height: 'auto' }}
        >
            {svgContent ? (
                <div className="relative w-full h-full">
                    {/* Main Logo Container with Clip Path */}
                    <div className="logo-wrapper relative w-full h-full will-change-[clip-path]">
                        <div
                            dangerouslySetInnerHTML={{ __html: svgContent }}
                            className="w-full h-full"
                        />
                    </div>

                    {/* Energy Beam / Leading Edge */}
                    <div
                        className="scan-beam absolute top-0 bottom-0 w-[40px] z-10 pointer-events-none"
                        style={{
                            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.8), rgba(79, 245, 247, 0.6), transparent)',
                            mixBlendMode: 'overlay',
                            left: '0',
                            transform: 'translateX(-50%)'
                        }}
                    />
                </div>
            ) : (
                <div className="w-full pb-[30%]" />
            )}
        </div>
    );
}
