'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type MotionIntensity = 0 | 1 | 2 | 3;

interface MotionContextValue {
  readonly intensity: MotionIntensity;
  readonly reduced: boolean;
}

const MotionContext = createContext<MotionContextValue>({ intensity: 1, reduced: false });

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export interface MotionProviderProps {
  children: ReactNode;
  intensity?: MotionIntensity;
  reduced?: boolean;
}

export function MotionProvider({ children, intensity = 1, reduced }: MotionProviderProps) {
  const systemReduced = useSystemReducedMotion();
  const value = useMemo(() => ({ intensity, reduced: reduced ?? systemReduced }), [intensity, reduced, systemReduced]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotionPreferences(): MotionContextValue {
  return useContext(MotionContext);
}
