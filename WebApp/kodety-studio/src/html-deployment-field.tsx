import { Children, cloneElement, isValidElement, useRef, useState, type ReactElement, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import * as Select from '@radix-ui/react-select';
import { DisclosureChevron } from "../../../components/ui/disclosure-summary";
import { HtmlPublishIcon } from './html-publish-icon';

// Exact Keyline Icons stroke SVGs (MIT), icons/stroke/{name}.svg:
// https://github.com/keyline-icons/keyline-icons/tree/main/icons/stroke
// Copyright (c) 2026 Keyline Icons. See components/ui/KEYLINE-ICONS-LICENSE.txt.
const glyphs = {
  "key": (<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M10 12C10 14.2091 8.2091 16 6 16C3.7909 16 2 14.2091 2 12C2 9.7909 3.7909 8 6 8C8.2091 8 10 9.7909 10 12ZM10 12L22 12M17 12L17 16M21 12L21 16" fill="none"/>
</svg>),
  "user": (<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M11 14H13C16.3137 14 19 16.6863 19 20C19 20.5523 18.5523 21 18 21H6C5.44772 21 5 20.5523 5 20C5 16.6863 7.68629 14 11 14ZM12 4C13.6569 4 15 5.34315 15 7C15 8.65685 13.6569 10 12 10C10.3431 10 9 8.65685 9 7C9 5.34315 10.3431 4 12 4Z"/>
</svg>),
  "folder": (<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 17C21 18.6569 19.6569 20 18 20L6 20C4.3431 20 3 18.6569 3 17Z"/>
</svg>),
  "git-branch": (<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M6 21V9C6.16667 12 8.2 18 15 18M6 9C7.65685 9 9 7.65685 9 6C9 4.34315 7.65685 3 6 3C4.34315 3 3 4.34315 3 6C3 7.65685 4.34315 9 6 9ZM18 21C19.6569 21 21 19.6569 21 18C21 16.3431 19.6569 15 18 15C16.3431 15 15 16.3431 15 18C15 19.6569 16.3431 21 18 21Z"/>
</svg>),
  "globe": (<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM2 12H22M12 2C14.6667 5 16 8.5 16 12C16 15.5 14.6667 19 12 22C9.33333 19 8 15.5 8 12C8 8.5 9.33333 5 12 2Z"/>
</svg>),
  "file-text": (<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H16C18.2091 22 20 20.2091 20 18V8L14 2ZM14 2V5C14 6.65685 15.3431 8 17 8H20M8 13H12M8 17H16"/>
</svg>),
};
function fieldGlyph(label: string): keyof typeof glyphs {
  if (/token/i.test(label)) return 'key';
  if (/branch/i.test(label)) return 'git-branch';
  if (/conta|account|equipe|team|organiza/i.test(label)) return 'user';
  if (/hospedagem|hosting|ambiente|environment/i.test(label)) return 'globe';
  if (/pasta|folder|projeto|project|reposit/i.test(label)) return 'folder';
  return 'file-text';
}

type NativeFieldProps = InputHTMLAttributes<HTMLInputElement> & SelectHTMLAttributes<HTMLSelectElement>;
type DeploymentSelectProps = { value: string; onValueChange(value: string): void; children: ReactNode; disabled?: boolean; 'aria-label'?: string };

/** Uses the same accessible select primitive as Settings, including its open state. */
export function DeploymentSelect({ value, onValueChange, children, disabled, 'aria-label': label }: DeploymentSelectProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = Children.toArray(children).filter(isValidElement) as ReactElement<{ value: string; children: ReactNode; disabled?: boolean }>[];
  return <Select.Root value={`v:${value}`} onValueChange={next => onValueChange(next.slice(2))} disabled={disabled} open={open} onOpenChange={setOpen}>
    <Select.Trigger ref={trigger} className="web-publish-select" aria-label={label}>
      <Select.Value />
      <Select.Icon asChild><DisclosureChevron className="web-publish-select-chevron" expanded={open} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={trigger.current?.closest('dialog') || undefined}><Select.Content className="web-publish-select-menu" position="popper" sideOffset={6} align="start" collisionPadding={12}>
      <Select.Viewport>{options.map(option => <Select.Item key={option.props.value} value={`v:${option.props.value}`} disabled={option.props.disabled} className="web-publish-select-option">
        <Select.ItemText>{option.props.children}</Select.ItemText>
        <Select.ItemIndicator className="web-publish-select-check"><HtmlPublishIcon name="check" /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
    </Select.Content></Select.Portal>
  </Select.Root>;
}

/** Settings-style compound surface; the original native field keeps all handlers and constraints. */
export function DeploymentField({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`web-field ${className}`}><span>{label}</span>{Children.map(children, child => {
    if (!isValidElement(child) || (child.type !== 'input' && child.type !== 'select' && child.type !== DeploymentSelect)) return child;
    const control = child as ReactElement<NativeFieldProps>;
    const isSelect = child.type === 'select';
    return <span className="web-publish-control" data-disabled={control.props.disabled || undefined}>
      <span className="web-publish-control-icon" aria-hidden="true">{glyphs[fieldGlyph(label)]}</span>
      {cloneElement(control, { 'aria-label': control.props['aria-label'] || label })}
      {isSelect && <DisclosureChevron className="web-publish-control-chevron" />}
    </span>;
  })}</label>;
}
