'use client';

import { Children, Fragment, cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectTrigger } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { HtmlSettingsFieldGlyph, inferHtmlSettingsFieldKind, type HtmlSettingsFieldKind } from './HtmlSettingsControls';

export interface ProjectSettingsFieldControlProps {
  label: string;
  children: ReactNode;
  kind?: HtmlSettingsFieldKind;
}

type SettingsControlDataAttributes = {
  'data-html-settings-control'?: string;
  'data-project-settings-control'?: string;
  'data-kodety-settings-control'?: string;
  'data-kodety-settings-control-inner'?: string;
  'data-kodety-settings-select-content'?: string;
  'data-field-kind'?: HtmlSettingsFieldKind;
};

const FIELD_SURFACE_CLASS = cn(
  'group/project-settings-field relative flex min-w-0 overflow-hidden rounded-[9px] border border-transparent bg-white/[.055]',
  'transition-[border-color,background-color] hover:bg-white/[.07]',
  'focus-within:border-[var(--kodety-focus)]/75 focus-within:bg-white/[.075]',
);

function textareaMinHeightClassName(className: string | undefined) {
  return className
    ?.split(/\s+/)
    .filter(token => token.startsWith('min-h-'))
    .join(' ');
}

function FieldGlyph({ kind, multiline = false }: { kind: HtmlSettingsFieldKind; multiline?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'shrink-0 bg-black/[.07] text-white/30 transition-colors',
        'group-hover/project-settings-field:text-white/48 group-focus-within/project-settings-field:text-[var(--kodety-accent-hover)]',
        multiline
          ? 'flex h-8 w-full items-center justify-start border-b border-white/[.045] px-2.5'
          : 'grid w-9 place-items-center border-r border-white/[.045]',
      )}
    >
      <HtmlSettingsFieldGlyph kind={kind} />
    </span>
  );
}

function decorateInput(element: ReactElement<ComponentProps<typeof Input>>, label: string, kind: HtmlSettingsFieldKind) {
  const inputProps: Partial<ComponentProps<typeof Input>> & SettingsControlDataAttributes = {
    'aria-label': element.props['aria-label'] || label,
    'data-kodety-settings-control-inner': '',
    className: cn(
      'h-full min-w-0 flex-1 px-2.5 text-[11px]',
      element.props.className,
      'h-full min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none outline-none',
      'focus-visible:border-transparent focus-visible:ring-0',
    ),
  };

  return (
    <div
      data-html-settings-control
      data-project-settings-control
      data-kodety-settings-control
      data-field-kind={kind}
      className={cn(FIELD_SURFACE_CLASS, 'h-9 items-stretch')}
      onPointerDown={event => event.stopPropagation()}
    >
      <FieldGlyph kind={kind} />
      {cloneElement(element, inputProps)}
    </div>
  );
}

function decorateTextarea(element: ReactElement<ComponentProps<typeof Textarea>>, label: string, kind: HtmlSettingsFieldKind) {
  const textareaProps: Partial<ComponentProps<typeof Textarea>> & SettingsControlDataAttributes = {
    'aria-label': element.props['aria-label'] || label,
    'data-kodety-settings-control-inner': '',
    className: cn(
      'min-h-20 w-full flex-1 px-2.5 py-2 text-[11px] leading-4',
      element.props.className,
      'w-full flex-1 rounded-none border-0 bg-transparent shadow-none outline-none',
      'focus-visible:border-transparent focus-visible:ring-0',
    ),
  };

  return (
    <div
      data-html-settings-control
      data-project-settings-control
      data-kodety-settings-control
      data-field-kind={kind}
      className={cn(FIELD_SURFACE_CLASS, 'min-h-24 flex-col items-stretch', textareaMinHeightClassName(element.props.className))}
      onPointerDown={event => event.stopPropagation()}
    >
      <FieldGlyph kind={kind} multiline />
      {cloneElement(element, textareaProps)}
    </div>
  );
}

function decorateSelectTrigger(element: ReactElement<ComponentProps<typeof SelectTrigger>>, label: string, kind: HtmlSettingsFieldKind) {
  const triggerProps: Partial<ComponentProps<typeof SelectTrigger>> & SettingsControlDataAttributes = {
    'aria-label': element.props['aria-label'] || label,
    'data-html-settings-control': '',
    'data-project-settings-control': '',
    'data-kodety-settings-control': '',
    'data-field-kind': kind,
    className: cn(
      'group/project-settings-field h-9 w-full min-w-0 gap-0 overflow-hidden rounded-[9px] border-transparent bg-white/[.055] !p-0 !pr-2.5 text-[11px]',
      'transition-[border-color,background-color] hover:bg-white/[.07]',
      'focus-visible:border-[var(--kodety-focus)]/75 focus-visible:bg-white/[.075] focus-visible:ring-0',
      'data-[state=open]:border-[var(--kodety-focus)]/75 data-[state=open]:bg-white/[.075]',
      element.props.className,
      'h-9 min-w-0 rounded-[9px] border-transparent bg-white/[.055] !p-0 !pr-2.5',
    ),
    onPointerDown: event => {
      element.props.onPointerDown?.(event);
      event.stopPropagation();
    },
  };

  return cloneElement(
    element,
    triggerProps,
    <span
      aria-hidden="true"
      className={cn(
        'mr-2 grid h-full w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 transition-colors',
        'group-hover/project-settings-field:text-white/48 group-focus/project-settings-field:text-[var(--kodety-accent-hover)]',
        'group-data-[state=open]/project-settings-field:text-[var(--kodety-accent-hover)]',
      )}
    >
      <HtmlSettingsFieldGlyph kind={kind} />
    </span>,
    element.props.children,
  );
}

function decorateSelectContent(element: ReactElement<ComponentProps<typeof SelectContent>>) {
  const contentProps: Partial<ComponentProps<typeof SelectContent>> & SettingsControlDataAttributes = {
    'data-kodety-settings-select-content': '',
    className: cn('min-w-[var(--radix-select-trigger-width)] rounded-[9px] border-white/[.08] bg-[var(--kodety-panel)]', element.props.className),
  };

  return cloneElement(element, contentProps);
}

function decorateSelect(
  element: ReactElement<ComponentProps<typeof Select>>,
  label: string,
  kind: HtmlSettingsFieldKind,
): { element: ReactElement; decorated: boolean } {
  let decorated = false;
  const children = Children.map(element.props.children, child => {
    if (!isValidElement(child)) return child;

    if (!decorated && child.type === SelectTrigger) {
      decorated = true;
      return decorateSelectTrigger(child as ReactElement<ComponentProps<typeof SelectTrigger>>, label, kind);
    }

    if (child.type === SelectContent) {
      return decorateSelectContent(child as ReactElement<ComponentProps<typeof SelectContent>>);
    }

    return child;
  });

  return {
    element: decorated ? cloneElement(element, undefined, children) : element,
    decorated,
  };
}

/**
 * Gives the simple controls used by Project Settings the same single-surface
 * grammar as the Builder inspector. Non-control siblings (errors, hints and
 * counters) are intentionally returned untouched.
 */
export function ProjectSettingsFieldControl({ label, children, kind = inferHtmlSettingsFieldKind(label) }: ProjectSettingsFieldControlProps) {
  let decorated = false;

  const decorateChild = (child: ReactNode): ReactNode => {
    if (decorated || !isValidElement(child)) return child;

    if (child.type === Input) {
      decorated = true;
      return decorateInput(child as ReactElement<ComponentProps<typeof Input>>, label, kind);
    }

    if (child.type === Textarea) {
      decorated = true;
      return decorateTextarea(child as ReactElement<ComponentProps<typeof Textarea>>, label, kind);
    }

    if (child.type === SelectTrigger) {
      decorated = true;
      return decorateSelectTrigger(child as ReactElement<ComponentProps<typeof SelectTrigger>>, label, kind);
    }

    if (child.type === Select) {
      const result = decorateSelect(child as ReactElement<ComponentProps<typeof Select>>, label, kind);
      decorated = result.decorated;
      return result.element;
    }

    if (child.type === Fragment) {
      const fragmentChildren = Children.map((child as ReactElement<{ children?: ReactNode }>).props.children, decorateChild);
      return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, fragmentChildren);
    }

    // Settings fields often group a control with a preview, status badge or
    // helper copy in a native wrapper. Descend through DOM-only wrappers so
    // the first authored control still receives the full Builder treatment,
    // without reaching through custom components that own their own UI.
    if (typeof child.type === 'string') {
      const nativeChild = child as ReactElement<{ children?: ReactNode }>;
      if (nativeChild.props.children === undefined) return child;
      const nestedChildren = Children.map(nativeChild.props.children, decorateChild);
      return cloneElement(nativeChild, undefined, nestedChildren);
    }

    return child;
  };

  return <>{Children.map(children, decorateChild)}</>;
}

// Generic name for other authored-data workspaces that share the same visual
// grammar. Keep the original export for backwards compatibility in Settings.
export const HtmlSettingsFieldControl = ProjectSettingsFieldControl;
