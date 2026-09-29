/** Keep standalone WordPress workspaces visually identical to the Builder. */
export const WORDPRESS_WORKSPACE_TOASTER_PROPS = {
  theme: 'dark' as const,
  position: 'bottom-center' as const,
  offset: 76,
  mobileOffset: 20,
  gap: 8,
  visibleToasts: 3,
  expand: false,
  richColors: false,
  closeButton: true,
  className: 'kodety-editor-toaster [--width:min(360px,calc(100vw-32px))]!',
  toastOptions: {
    duration: 3200,
    classNames: {
      toast:
        'min-h-10! rounded-xl! border! border-white/10! bg-[#1b1b1b]/95! py-2! pr-2! pl-3.5! text-white! shadow-[0_14px_40px_rgba(0,0,0,0.35),0_1px_0_rgba(255,255,255,0.05)_inset]! backdrop-blur-2xl!',
      content: 'gap-0!',
      title: 'text-xs! font-medium! tracking-[-0.01em]! text-white!',
      description: 'hidden!',
      icon: 'size-4! text-[#AFAFFF]!',
      closeButton:
        'relative! inset-auto! order-last! ml-3! flex! h-8! w-auto! shrink-0! translate-x-0! translate-y-0! items-center! justify-center! rounded-lg! border-0! bg-white/[0.06]! px-3! text-[11px]! font-medium! text-white/65! shadow-none! hover:bg-white/[0.1]! hover:text-white!',
      actionButton:
        'h-7! rounded-lg! bg-white/[0.08]! px-3! text-[11px]! font-medium! text-white! hover:bg-white/[0.12]!',
      cancelButton: 'h-7! rounded-lg! bg-white/[0.06]! px-3! text-[11px]! font-medium! text-white/70!',
      success: 'border-[#9393FF]/25! bg-[#18181b]/98! text-[#AFAFFF]! [&_[data-title]]:text-[#AFAFFF]! [&_[data-icon]]:text-[#AFAFFF]!',
      error: 'border-red-500/20! [&_[data-icon]]:text-red-500!',
      warning: 'border-amber-500/20! [&_[data-icon]]:text-amber-500!',
      info: 'border-[#9393FF]/25! bg-[#18181b]/98! text-[#AFAFFF]! [&_[data-title]]:text-[#AFAFFF]! [&_[data-icon]]:text-[#AFAFFF]!',
    },
  },
};
