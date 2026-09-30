import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge the design-system tokens so that e.g.
// cn("text-caption", "text-fg-2") keeps both (size vs colour) and
// cn("rounded-chip", "rounded-card") resolves to the last one.
const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            "font-size": [{ text: ["micro", "caption", "body-sm", "body", "title", "h2", "display", "hero"] }],
            rounded: [{ rounded: ["chip", "control", "card"] }],
        },
    },
})

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
