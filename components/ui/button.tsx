import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all motion-reduce:transition-none cursor-pointer disabled:cursor-not-allowed disabled:!border-transparent disabled:!bg-neutral-500/20 disabled:!text-white/70 disabled:!shadow-none disabled:opacity-100 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:!border-transparent data-[disabled=true]:!bg-neutral-500/20 data-[disabled=true]:!text-white/70 data-[disabled=true]:!shadow-none data-[disabled=true]:opacity-100 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-[var(--kodety-accent)] text-white hover:bg-[var(--kodety-accent-hover)] [&_svg]:text-current [&_svg]:opacity-100',
        destructive: 'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline: 'border border-border/70 bg-transparent shadow-none hover:border-border hover:bg-transparent hover:text-foreground',
        secondary: 'bg-secondary text-muted-foreground hover:bg-secondary/70 backdrop-blur',
        purple: 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30',
        data: 'border border-[var(--kodety-accent)]/28 bg-[var(--kodety-accent)]/12 text-[var(--kodety-accent-hover)] hover:bg-[var(--kodety-accent)]/16',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-secondary/70 text-muted-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        input: 'border border-border/70 bg-transparent text-muted-foreground hover:border-border hover:bg-transparent hover:text-foreground',
        white: 'bg-white text-neutral-900',
        overlay: 'bg-white/90 text-neutral-800 hover:bg-white dark:bg-neutral-800/90 dark:text-white dark:hover:bg-neutral-800',
        inline_variable_canvas: 'bg-white/5 text-white hover:bg-white/15',
        variable: 'text-muted-foreground hover:text-purple-300',
      },
      size: {
        default: 'text-sm h-9 px-4 rounded-xl py-2 has-[>svg]:px-3',
        lg: 'text-sm h-10 rounded-md px-6 has-[>svg]:px-4',
        sm: 'text-xs h-8 rounded-lg gap-1.5 px-2.5 has-[>svg]:px-2.5 [&>svg]:!size-3',
        xs: 'text-xs h-6 rounded-md gap-1.5 px-2 has-[>svg]:px-1.5 [&>svg]:!size-3',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
        'icon-xs': 'size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0 [&>svg]:!size-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  disabled,
  onClick,
  tabIndex,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      {...props}
      data-slot="button"
      data-size={size ?? 'sm'}
      data-variant={variant ?? 'default'}
      data-disabled={disabled ? 'true' : undefined}
      type={asChild ? undefined : (type ?? 'button')}
      disabled={asChild ? undefined : disabled}
      aria-disabled={asChild && disabled ? true : props['aria-disabled']}
      tabIndex={asChild && disabled ? -1 : tabIndex}
      onClick={disabled
        ? (event) => {
          event.preventDefault()
          event.stopPropagation()
        }
        : onClick}
      className={cn(buttonVariants({ variant, size, className }))}
    />
  )
}

export { Button, buttonVariants }
