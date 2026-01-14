import React from 'react';

interface StatRingProps {
    value: string | number;
    progress: number; // 0-100
    label: string;
    subLabel?: string;
    color: string;
    size?: number;
    strokeWidth?: number;
}

const StatRing: React.FC<StatRingProps> = ({
    value,
    progress,
    label,
    subLabel,
    color,
    size = 120,
    strokeWidth = 8,
}) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (progress / 100) * circumference;

    return (
        <div className="flex flex-col items-center justify-center">
            <div className="relative" style={{ width: size, height: size }}>
                {/* Background Circle */}
                <svg
                    className="transform -rotate-90"
                    width={size}
                    height={size}
                >
                    <circle
                        className="text-gray-700"
                        stroke="currentColor"
                        strokeWidth={strokeWidth}
                        fill="transparent"
                        r={radius}
                        cx={size / 2}
                        cy={size / 2}
                    />
                    {/* Progress Circle */}
                    <circle
                        stroke={color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        fill="transparent"
                        r={radius}
                        cx={size / 2}
                        cy={size / 2}
                        className="transition-all duration-1000 ease-out"
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-white">{value}</span>
                    <span className="text-xs text-gray-400 uppercase tracking-widest">{label}</span>
                </div>
            </div>
            {subLabel && (
                <div className="mt-2 text-xs text-gray-500">{subLabel}</div>
            )}
        </div>
    );
};

export default StatRing;
