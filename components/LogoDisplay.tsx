'use client';
import Image from 'next/image';

interface LogoDisplayProps {
    src: string;
    alt: string;
    triCode?: string;
    className?: string;
    primaryColor?: string;
    variant?: 'standard' | 'animated';
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

export default function LogoDisplay({ src, alt, triCode, className, primaryColor, variant = 'standard' }: LogoDisplayProps) {
    // FORCE STATIC MODE: User requested removal of animations due to performance.
    // We ignore the 'variant' prop and always render the standard image.

    // Use triCode for local standard logos if available, otherwise use src
    const imageSrc = triCode ? `/logos/${triCode}.svg` : src;

    return (
        <div className={`relative ${className}`}>
            <Image
                src={imageSrc}
                alt={alt}
                fill
                className="object-contain"
                priority={true}
            />
        </div>
    );
}
