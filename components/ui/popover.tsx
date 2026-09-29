'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

import { cn } from '@/lib/utils'

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align,
  side,
  sideOffset,
  collisionPadding,
  panelTitle,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  panelTitle?: React.ReactNode
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align ?? (panelTitle ? 'start' : 'center')}
        side={side ?? (panelTitle ? 'left' : 'bottom')}
        sideOffset={sideOffset ?? (panelTitle ? 12 : 4)}
        collisionPadding={collisionPadding ?? (panelTitle ? 12 : undefined)}
        className={cn(
          'bg-popover dark:bg-[#161616] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 motion-reduce:animate-none z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-lg border border-border/95 dark:border-white/[0.18] p-4 shadow-xl outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'dark:[&_[data-slot=input]]:!border-white/[0.18] dark:[&_[data-slot=input-group]]:!border-white/[0.18] dark:[&_[data-slot=select-trigger]]:!border-white/[0.18] dark:[&_[data-slot=button][data-variant=input]]:!border-white/[0.18] dark:[&_[data-slot=color-picker-trigger]]:!border-white/[0.18]',
          className
        )}
        {...props}
      >
        {panelTitle && (
          <div
            data-slot="popover-panel-title"
            className="mb-2 border-b border-border/80 px-1 pb-2 text-[11px] font-semibold tracking-[-0.01em] text-foreground dark:border-white/[0.12]"
          >
            {panelTitle}
          </div>
        )}
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
