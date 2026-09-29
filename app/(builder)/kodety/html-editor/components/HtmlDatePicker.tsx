'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from '@/components/ui/gravity-icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getAdminUiLocale } from '@/lib/admin-ui-locale';

function parseDatePart(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null;
}

function formatDatePart(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeParts(value: string) {
  const match = /T(\d{2}):(\d{2})/.exec(value);
  const now = new Date();
  return {
    hour: match?.[1] || String(now.getHours()).padStart(2, '0'),
    minute: match?.[2] || String(now.getMinutes()).padStart(2, '0'),
  };
}

export function HtmlDatePicker({
  label,
  value,
  onChange,
  includeTime = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  includeTime?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseDatePart(value);
  const selectedTime = timeParts(value);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initial = selectedDate || new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const locale = getAdminUiLocale();

  useEffect(() => {
    if (!open) return;
    const initial = parseDatePart(value) || new Date();
    setVisibleMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
  }, [open, value]);

  const days = useMemo(() => {
    const firstWeekday = visibleMonth.getDay();
    return Array.from({ length: 42 }, (_, index) =>
      new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index - firstWeekday + 1),
    );
  }, [visibleMonth]);
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 7 + index)),
    ),
    [locale],
  );
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')), []);
  const selectedKey = selectedDate ? formatDatePart(selectedDate) : '';
  const today = new Date();
  const todayKey = formatDatePart(today);
  const dateLabel = selectedDate
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(selectedDate)
    : 'Selecionar data';
  const displayValue = selectedDate && includeTime
    ? `${dateLabel} · ${selectedTime.hour}:${selectedTime.minute}`
    : dateLabel;
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(visibleMonth);

  const emit = (date: Date, hour = selectedTime.hour, minute = selectedTime.minute) => {
    const datePart = formatDatePart(date);
    onChange(includeTime ? `${datePart}T${hour}:${minute}` : datePart);
  };
  const chooseDate = (date: Date) => {
    emit(date);
    if (!includeTime) setOpen(false);
  };
  const chooseTime = (next: Partial<{ hour: string; minute: string }>) => {
    emit(selectedDate || today, next.hour || selectedTime.hour, next.minute || selectedTime.minute);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-kodety-settings-control
          data-kodety-cms-date-trigger
          aria-label={label}
          disabled={disabled}
          className={`group/date flex h-9 w-full min-w-0 items-stretch overflow-hidden rounded-[9px] border bg-white/[.055] text-left text-[11px] outline-none transition-[border-color,background-color] hover:bg-white/[.07] focus-visible:border-[var(--kodety-focus)]/75 disabled:cursor-not-allowed disabled:opacity-45 ${open ? 'border-[var(--kodety-focus)]/75 bg-white/[.075]' : 'border-transparent'}`}
        >
          <span className="grid w-9 shrink-0 place-items-center border-r border-white/[.045] bg-black/[.07] text-white/30 transition-colors group-hover/date:text-white/48">
            <Calendar aria-hidden="true" className="size-3.5" />
          </span>
          <span className={`flex min-w-0 flex-1 items-center truncate px-2.5 ${selectedDate ? 'text-foreground' : 'text-muted-foreground'}`}>
            {displayValue}
          </span>
          <ChevronDown aria-hidden="true" className="mr-2.5 size-3 self-center text-white/28" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-kodety-cms-calendar
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="z-[10020] w-[280px] rounded-[12px] border-white/[.08] bg-[#171717] p-3 shadow-[0_18px_48px_rgba(0,0,0,.42)]"
      >
        <div className="mb-3 flex h-8 items-center justify-between">
          <button
            type="button"
            className="grid size-8 place-items-center rounded-[7px] text-muted-foreground outline-none transition-colors hover:bg-white/[.06] hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]"
            aria-label="Mês anterior"
            onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <p className="text-balance text-center text-[11px] font-medium capitalize text-foreground">{monthLabel}</p>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-[7px] text-muted-foreground outline-none transition-colors hover:bg-white/[.06] hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]"
            aria-label="Próximo mês"
            onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1" aria-hidden="true">
          {weekdays.map((weekday, index) => (
            <span key={`${weekday}-${index}`} className="grid h-6 place-items-center text-[9px] font-medium uppercase text-white/28">
              {weekday}
            </span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map(date => {
            const key = formatDatePart(date);
            const inCurrentMonth = date.getMonth() === visibleMonth.getMonth();
            const selected = key === selectedKey;
            const isToday = key === todayKey;
            return (
              <button
                key={key}
                type="button"
                aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(date)}
                aria-pressed={selected}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => chooseDate(date)}
                className={`grid size-8 place-items-center rounded-[7px] text-[10px] outline-none transition-[background-color,color,box-shadow] focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)] ${
                  selected
                    ? 'bg-white/[.16] font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/.12)]'
                    : inCurrentMonth
                      ? 'text-white/72 hover:bg-white/[.065] hover:text-white'
                      : 'text-white/20 hover:bg-white/[.04] hover:text-white/45'
                } ${isToday && !selected ? 'shadow-[inset_0_0_0_1px_rgb(255_255_255/.16)]' : ''}`}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
        {includeTime ? (
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2 border-t border-white/[.055] pt-3">
            <div>
              <span className="mb-1 block text-[8px] font-medium uppercase tracking-[.06em] text-white/30">Hora</span>
              <Select value={selectedTime.hour} onValueChange={hour => chooseTime({ hour })}>
                <SelectTrigger aria-label="Hora" className="h-8 w-full rounded-[8px] border-transparent bg-white/[.055] text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-52">{hours.map(hour => <SelectItem key={hour} value={hour}>{hour}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <span className="pb-2 text-[11px] text-white/28">:</span>
            <div>
              <span className="mb-1 block text-[8px] font-medium uppercase tracking-[.06em] text-white/30">Minuto</span>
              <Select value={selectedTime.minute} onValueChange={minute => chooseTime({ minute })}>
                <SelectTrigger aria-label="Minuto" className="h-8 w-full rounded-[8px] border-transparent bg-white/[.055] text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-52">{minutes.map(minute => <SelectItem key={minute} value={minute}>{minute}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between border-t border-white/[.055] pt-3">
          <button
            type="button"
            className="h-7 rounded-[6px] px-2 text-[10px] text-muted-foreground outline-none transition-colors hover:bg-white/[.055] hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)] disabled:opacity-35"
            disabled={!selectedDate}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            Limpar
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="h-7 rounded-[6px] px-2 text-[10px] text-muted-foreground outline-none transition-colors hover:bg-white/[.055] hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]"
              onClick={() => {
                const now = new Date();
                emit(now, String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'));
                if (!includeTime) setOpen(false);
              }}
            >
              {includeTime ? 'Agora' : 'Hoje'}
            </button>
            {includeTime ? (
              <button
                type="button"
                className="h-7 rounded-[6px] bg-white/[.085] px-2.5 text-[10px] font-medium text-foreground outline-none transition-colors hover:bg-white/[.12] focus-visible:ring-1 focus-visible:ring-[var(--kodety-focus)]"
                onClick={() => setOpen(false)}
              >
                Concluir
              </button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
