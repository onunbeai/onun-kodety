/** Shared by the Builder and its Studio host; no editor runtime dependencies. */
export const TOAST_PROPS = {
  theme: 'dark' as const,
  position: 'bottom-center' as const,
  offset: 76,
  mobileOffset: 20,
  gap: 8,
  visibleToasts: 3,
  expand: false,
  richColors: false,
  closeButton: true,
  className: 'kodety-editor-toaster',
  toastOptions: {
    duration: 3200,
    classNames: {
      toast: 'kodety-toast',
      content: 'kodety-toast-content',
      title: 'kodety-toast-title',
      description: 'kodety-toast-description',
      icon: 'kodety-toast-icon',
      actionButton: 'kodety-toast-action',
      cancelButton: 'kodety-toast-cancel',
      success: 'kodety-toast-success',
      error: 'kodety-toast-error',
      warning: 'kodety-toast-warning',
      info: 'kodety-toast-info',
    },
  },
};
