import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badge / chip: mono uppercase, 1px border, 4px radius. One per card at most
 * (e.g. "B2B"). `default` is the TV-network style neutral chip.
 */
const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-chip border px-1.5 py-px text-micro font-bold uppercase tracking-chip",
  {
    variants: {
      variant: {
        default: "border-line font-medium text-fg-3",
        brand: "border-brand/50 text-brand",
        warn: "border-warn/45 text-warn",
        pos: "border-pos/45 text-pos",
        destructive: "border-neg/45 text-neg",
        model: "border-model/50 text-model",
        secondary: "border-line text-fg-1",
        outline: "border-line font-medium text-fg-3",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
