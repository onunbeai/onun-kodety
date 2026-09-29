'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { composeCssLengthDraft, splitCssLengthDraft } from '@/lib/html-editor/css-length-draft';
import { cn } from '@/lib/utils';

interface HtmlCssLengthFieldProps {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  icon?: ReactNode;
  min?: number;
  className?: string;
  emptyValue?: string;
  defaultUnit?: string;
  /** CSS property used by the project design-token connector. */
  tokenProperty?: string;
}

/**
 * Stable CSS length editor used by the compact inspector grids.
 *
 * The editable draft includes its unit (for example `2px`) so compact fields
 * keep one continuous value instead of spending a fixed segment on a suffix.
 * Parent updates are ignored while the field has focus, so a delayed
 * canvas/computed-style refresh cannot overwrite the next character being typed.
 */
export function HtmlCssLengthField({
  value,
  onCommit,
  label,
  icon,
  min,
  className,
  emptyValue = '0',
  defaultUnit = 'px',
  tokenProperty,
}: HtmlCssLengthFieldProps) {
  const external = splitCssLengthDraft(value, { defaultUnit, emptyValue });
  const externalDraft = `${external.value}${external.unit}`;
  const [draft, setDraft] = useState(externalDraft);
  const retainedUnitRef = useRef(external.unit);
  const focusedRef = useRef(false);
  const externalRef = useRef(external);
  externalRef.current = external;

  useEffect(() => {
    if (focusedRef.current) return;
    retainedUnitRef.current = external.unit;
    setDraft(`${external.value}${external.unit}`);
  }, [external.unit, external.value]);

  const commitDraft = useCallback((nextDraft: string) => {
    const cssValue = composeCssLengthDraft(nextDraft, retainedUnitRef.current || defaultUnit);
    if (cssValue === null) return;
    const nextParts = splitCssLengthDraft(cssValue, { defaultUnit, emptyValue: '' });
    if (nextParts.unit) retainedUnitRef.current = nextParts.unit;
    onCommit(cssValue);
  }, [defaultUnit, onCommit]);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const typed = event.target.value;
    setDraft(typed);
    commitDraft(typed);
  }, [commitDraft]);

  const stepDraft = useCallback((direction: 1 | -1, accelerated: boolean) => {
    const parsed = Number.parseFloat(draft);
    const current = Number.isFinite(parsed) ? parsed : 0;
    const step = accelerated ? 10 : 1;
    const next = min === undefined
      ? current + direction * step
      : Math.max(min, current + direction * step);
    const currentParts = splitCssLengthDraft(draft, {
      defaultUnit: retainedUnitRef.current || defaultUnit,
      emptyValue: '',
    });
    const nextUnit = currentParts.unit || retainedUnitRef.current || defaultUnit;
    const nextDraft = `${next}${nextUnit}`;
    setDraft(nextDraft);
    commitDraft(nextDraft);
  }, [commitDraft, defaultUnit, draft, min]);

  return (
    <InputGroup
      data-slot="html-css-length-field"
      data-design-token-property={tokenProperty}
      className={cn('h-7 min-w-0 overflow-hidden rounded-[7px]', className)}
    >
      {icon && (
        <InputGroupAddon
          aria-hidden="true"
          className="w-7 shrink-0 justify-center py-0 pl-2 pr-1 text-muted-foreground"
        >
          {icon}
        </InputGroupAddon>
      )}
      <InputGroupInput
        value={draft}
        inputMode="decimal"
        aria-label={label}
        placeholder="0"
        className="h-7 min-w-0 px-1 text-[10px] tabular-nums"
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          const valid = composeCssLengthDraft(draft, retainedUnitRef.current || defaultUnit);
          if (valid === null) {
            setDraft(`${externalRef.current.value}${externalRef.current.unit}`);
          } else if (!draft.trim() && emptyValue) {
            const restored = `${emptyValue}${retainedUnitRef.current || defaultUnit}`;
            setDraft(restored);
            commitDraft(restored);
          } else {
            const normalized = splitCssLengthDraft(valid, { defaultUnit, emptyValue: '' });
            setDraft(`${normalized.value}${normalized.unit}`);
          }
        }}
        onChange={handleChange}
        onKeyDown={event => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            stepDraft(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
          } else if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            retainedUnitRef.current = externalRef.current.unit;
            setDraft(`${externalRef.current.value}${externalRef.current.unit}`);
            event.currentTarget.blur();
          }
        }}
      />
    </InputGroup>
  );
}
