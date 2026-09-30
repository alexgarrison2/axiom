import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The panel: #0b1019 → #070a10 gradient, 1px line, 16px radius, tight
 * 14/16px padding. `wash` adds the soft team-colour radial behind each side
 * (pass the away/home colours); `interactive` brightens the edge on hover.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  wash?: { away: string; home: string } | null
  interactive?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, wash, interactive, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "panel p-card text-fg-1",
        wash && "team-wash",
        interactive && "panel-hover",
        className
      )}
      style={
        wash
          ? ({ "--ac": wash.away, "--hc": wash.home, ...style } as React.CSSProperties)
          : style
      }
      {...props}
    />
  )
)
Card.displayName = "Card"

/** Top row: label/time on the left, one chip on the right. */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex min-h-[22px] items-center justify-between gap-3", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

/** Mono uppercase, letter-spaced title (e.g. "7:00 PM", "GOALIES"). */
const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("font-sans text-caption font-bold uppercase tracking-[0.24em] text-fg-1", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("mt-3", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mt-4 flex items-center justify-between gap-3", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardContent }
