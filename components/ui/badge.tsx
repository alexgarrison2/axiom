import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-chip border px-2 py-0.5 text-caption font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-brand/15 text-brand",
        secondary:
          "border-line bg-surface-2 text-fg-1",
        destructive:
          "border-transparent bg-neg/15 text-neg",
        outline: "border-line text-fg-2",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
