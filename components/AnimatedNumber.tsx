'use client';

import { motion, useSpring, useTransform } from 'framer-motion';
import { useEffect } from 'react';

interface AnimatedNumberProps {
    value: number;
    toFixed?: number;
    className?: string;
}

export default function AnimatedNumber({ value, toFixed = 0, className }: AnimatedNumberProps) {
    const spring = useSpring(0, { mass: 0.8, stiffness: 75, damping: 15 });
    const display = useTransform(spring, (current) => current.toFixed(toFixed));

    useEffect(() => {
        spring.set(value);
    }, [spring, value]);

    return <motion.span className={className}>{display}</motion.span>;
}
