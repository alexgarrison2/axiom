'use client';

import { memo, useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

interface AnimatedNumberProps {
    value: number;
    toFixed?: number;
    className?: string;
}

// memo prevents re-renders when the parent state changes but `value` hasn't.
// Starting the spring at `value` (not 0) prevents re-animation on remount —
// the number will only animate when `value` actually changes.
const AnimatedNumber = memo(function AnimatedNumber({ value, toFixed = 0, className }: AnimatedNumberProps) {
    const spring = useSpring(value, { mass: 0.8, stiffness: 75, damping: 15 });
    const display = useTransform(spring, (current) => current.toFixed(toFixed));

    useEffect(() => {
        spring.set(value);
    }, [spring, value]);

    return <motion.span className={className}>{display}</motion.span>;
});

export default AnimatedNumber;
