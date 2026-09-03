'use client';

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { useMotionPreferences } from './MotionProvider';

export interface MotionMetricProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  value: number;
  format?: (value: number) => ReactNode;
  duration?: number;
  label?: ReactNode;
}

export function MotionMetric({ value, format = Math.round, duration = 700, label, ...props }: MotionMetricProps) {
  const { reduced } = useMotionPreferences();
  const displayed = useRef(value);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const startValue = displayed.current;
    if (reduced || duration <= 0 || startValue === value) { displayed.current = value; setDisplay(value); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = startValue + (value - startValue) * eased;
      displayed.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, reduced, value]);
  return <output {...props} aria-label={typeof label === 'string' ? label : undefined}>{format(display)}</output>;
}
