'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

interface LogoDisplayProps {
    src: string;
    alt: string;
    size?: number; // Tailwind w/h class equivalent or pixel size? Let's use generic sizing
    mdSize?: number;
    className?: string; // For explicit width/height classes
}

export default function LogoDisplay({ src, alt, className }: LogoDisplayProps) {
    return (
        <motion.div
            className={`relative drop-shadow-lg ${className}`}
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
            <Image
                src={src}
                alt={alt}
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
        </motion.div>
    );
}
