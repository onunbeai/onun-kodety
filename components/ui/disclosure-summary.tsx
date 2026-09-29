'use client'

import type { ComponentProps } from 'react'
import './disclosure-summary.css'

// Keyline Icons, stroke/chevron-down.svg (MIT).
// https://github.com/keyline-icons/keyline-icons/blob/main/icons/stroke/chevron-down.svg
// Copyright (c) 2026 Keyline Icons. See KEYLINE-ICONS-LICENSE.txt.
export function DisclosureChevron({
  expanded,
  className = '',
  ...props
}: ComponentProps<'svg'> & { expanded?: boolean }) {
  return (
    <svg
      {...props}
      className={`kodety-disclosure-chevron ${className}`}
      data-expanded={expanded}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 9L12 15L18 9" />
    </svg>
  )
}

export function DisclosureSummary({
  children,
  className = '',
  ...props
}: ComponentProps<'summary'>) {
  return (
    <summary {...props} className={`kodety-disclosure-summary ${className}`}>
      <span className="kodety-disclosure-summary-content">{children}</span>
      <DisclosureChevron />
    </summary>
  )
}
