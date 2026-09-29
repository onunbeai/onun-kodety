// Keyline Icons stroke assets, retrieved from the official repository.
// https://github.com/keyline-icons/keyline-icons/tree/main/icons/stroke
// Copyright (c) 2026 Keyline Icons, MIT. See components/ui/KEYLINE-ICONS-LICENSE.txt.
const paths = {
  globe: 'M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM2 12H22M12 2C14.6667 5 16 8.5 16 12C16 15.5 14.6667 19 12 22C9.33333 19 8 15.5 8 12C8 8.5 9.33333 5 12 2Z',
  folder: 'M3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 17C21 18.6569 19.6569 20 18 20L6 20C4.3431 20 3 18.6569 3 17Z',
  download: 'M12 3V14M8 10L12 14L16 10M4 18V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V18',
  check: 'M5 12L9.66667 17L19 7',
  'chevron-right': 'M9 6L15 12L9 18',
};

export function HtmlPublishIcon({ name, className }: { name: keyof typeof paths; className?: string }) {
  return <svg aria-hidden="true" focusable="false" className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} />
  </svg>;
}
