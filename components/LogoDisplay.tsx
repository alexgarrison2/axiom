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

export default function LogoDisplay({ src, alt, triCode, className, primaryColor, variant = 'standard' }: LogoDisplayProps) {
    // Standard Logic
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
