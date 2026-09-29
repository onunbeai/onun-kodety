import React, { useEffect, useRef, useState } from 'react';
import {
  ControlType,
  defineComponent,
  emitComponentEvent,
  type CodayComponentProps,
  type CodayRadius,
  type CodaySpacing,
} from '@coday/components';

export interface CountdownProps extends CodayComponentProps {
  targetDate: string;
  title: string;
  completedText: string;
  showDays: boolean;
  showSeconds: boolean;
  showLabels: boolean;
  backgroundColor: string;
  cardColor: string;
  numberColor: string;
  labelColor: string;
  numberSize: number;
  gap: number;
  padding: CodaySpacing;
  radius: CodayRadius;
}

interface CountdownValue {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const EMPTY_COUNTDOWN: CountdownValue = {
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
};

function splitRemainingTime(totalSeconds: number): CountdownValue {
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

function spacingValue(value: CodaySpacing): string {
  return `${value.top}${value.unit} ${value.right}${value.unit} ${value.bottom}${value.unit} ${value.left}${value.unit}`;
}

function radiusValue(value: CodayRadius): string {
  return `${value.topLeft}${value.unit} ${value.topRight}${value.unit} ${value.bottomRight}${value.unit} ${value.bottomLeft}${value.unit}`;
}

export default function Countdown({
  targetDate,
  title,
  completedText,
  showDays,
  showSeconds,
  showLabels,
  backgroundColor,
  cardColor,
  numberColor,
  labelColor,
  numberSize,
  gap,
  padding,
  radius,
  style,
  className,
  instanceId,
}: CountdownProps) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const emittedTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const update = () => {
      const target = new Date(targetDate).getTime();
      if (!Number.isFinite(target)) {
        setRemaining(null);
        return;
      }

      const next = Math.max(0, Math.ceil((target - Date.now()) / 1_000));
      setRemaining(next);

      if (next === 0 && emittedTargetRef.current !== targetDate) {
        emittedTargetRef.current = targetDate;
        emitComponentEvent('complete', { targetDate }, instanceId);
      }
    };

    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [instanceId, targetDate]);

  const value = remaining === null ? EMPTY_COUNTDOWN : splitRemainingTime(remaining);
  const isComplete = remaining === 0;
  const units = [
    ...(showDays ? [{ key: 'days', label: 'Dias', value: value.days }] : []),
    { key: 'hours', label: 'Horas', value: value.hours },
    { key: 'minutes', label: 'Minutos', value: value.minutes },
    ...(showSeconds ? [{ key: 'seconds', label: 'Segundos', value: value.seconds }] : []),
  ];

  return (
    <section
      className={className}
      style={{
        ...style,
        boxSizing: 'border-box',
        width: '100%',
        padding: spacingValue(padding),
        borderRadius: radiusValue(radius),
        background: backgroundColor,
        color: numberColor,
        fontFamily: 'inherit',
        textAlign: 'center',
      }}
      aria-live="polite"
    >
      {title ? (
        <p style={{ margin: `0 0 ${Math.max(gap, 8)}px`, color: labelColor, fontSize: 14 }}>
          {title}
        </p>
      ) : null}

      {isComplete ? (
        <p style={{ margin: 0, color: numberColor, fontSize: numberSize, fontWeight: 700 }}>
          {completedText}
        </p>
      ) : (
        <time
          dateTime={targetDate}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${units.length}, minmax(0, 1fr))`,
            gap,
          }}
        >
          {units.map((unit) => (
            <span
              key={unit.key}
              style={{
                minWidth: 0,
                padding: '0.65em 0.4em',
                borderRadius: radiusValue(radius),
                background: cardColor,
              }}
            >
              <strong
                style={{
                  display: 'block',
                  color: numberColor,
                  fontSize: numberSize,
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: '-0.04em',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {remaining === null ? '--' : String(unit.value).padStart(2, '0')}
              </strong>
              {showLabels ? (
                <small
                  style={{
                    display: 'block',
                    marginTop: 8,
                    overflow: 'hidden',
                    color: labelColor,
                    fontSize: 11,
                    lineHeight: 1.2,
                    textOverflow: 'ellipsis',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  {unit.label}
                </small>
              ) : null}
            </span>
          ))}
        </time>
      )}
    </section>
  );
}

export const componentDefinition = defineComponent({
  id: 'coday.countdown',
  name: 'Countdown',
  displayName: 'Countdown',
  description: 'Contagem regressiva configurável para uma data e hora.',
  version: '1.0.0',
  component: Countdown,
  sizing: { width: 'fixed', height: 'hug', defaultWidth: 640, minWidth: 240 },
  events: {
    complete: {
      title: 'Countdown concluído',
      description: 'Emitido uma vez quando a contagem chega a zero.',
      payload: { targetDate: 'string' },
    },
  },
  controls: {
    targetDate: {
      type: ControlType.Date,
      title: 'Data final',
      description: 'Data e hora em que a contagem deve terminar.',
      mode: 'datetime',
      defaultValue: '2030-01-01T00:00',
      bindable: true,
      category: 'Content',
    },
    title: {
      type: ControlType.String,
      title: 'Título',
      defaultValue: 'O evento começa em',
      bindable: true,
      category: 'Content',
    },
    completedText: {
      type: ControlType.String,
      title: 'Texto final',
      defaultValue: 'Começou!',
      bindable: true,
      category: 'Content',
    },
    showDays: {
      type: ControlType.Boolean,
      title: 'Mostrar dias',
      defaultValue: true,
      category: 'Content',
    },
    showSeconds: {
      type: ControlType.Boolean,
      title: 'Mostrar segundos',
      defaultValue: true,
      category: 'Content',
    },
    showLabels: {
      type: ControlType.Boolean,
      title: 'Mostrar legendas',
      defaultValue: true,
      category: 'Content',
    },
    backgroundColor: {
      type: ControlType.Color,
      title: 'Fundo',
      defaultValue: '#111318',
      allowAlpha: true,
      allowTokens: true,
      category: 'Style',
    },
    cardColor: {
      type: ControlType.Color,
      title: 'Fundo dos números',
      defaultValue: '#1F2430',
      allowAlpha: true,
      allowTokens: true,
      category: 'Style',
    },
    numberColor: {
      type: ControlType.Color,
      title: 'Cor dos números',
      defaultValue: '#FFFFFF',
      allowTokens: true,
      category: 'Style',
    },
    labelColor: {
      type: ControlType.Color,
      title: 'Cor dos textos',
      defaultValue: '#A8B0C0',
      allowTokens: true,
      category: 'Style',
    },
    numberSize: {
      type: ControlType.Number,
      title: 'Tamanho dos números',
      defaultValue: 48,
      min: 18,
      max: 120,
      step: 1,
      unit: 'px',
      display: 'slider-input',
      responsive: true,
      category: 'Typography',
    },
    gap: {
      type: ControlType.Number,
      title: 'Espaçamento',
      defaultValue: 12,
      min: 0,
      max: 64,
      step: 1,
      unit: 'px',
      display: 'slider-input',
      responsive: true,
      category: 'Layout',
    },
    padding: {
      type: ControlType.Spacing,
      title: 'Padding',
      defaultValue: { top: 24, right: 24, bottom: 24, left: 24, unit: 'px', linked: true },
      responsive: true,
      category: 'Layout',
    },
    radius: {
      type: ControlType.Radius,
      title: 'Arredondamento',
      defaultValue: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16, unit: 'px', linked: true },
      responsive: true,
      category: 'Style',
    },
  },
});
