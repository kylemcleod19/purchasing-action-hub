// Demo metadata and a reset counter so pages reload after a demo reset.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { MetaResponse } from '../../shared/types';

interface DemoContextValue {
  meta: MetaResponse | null;
  resetCount: number;
  afterReset: () => void;
}

const DemoContext = createContext<DemoContextValue>({ meta: null, resetCount: 0, afterReset: () => {} });

export function DemoProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [resetCount, setResetCount] = useState(0);

  useEffect(() => {
    api<MetaResponse>('/meta').then(setMeta, () => setMeta(null));
  }, [resetCount]);

  const afterReset = useCallback(() => setResetCount((c) => c + 1), []);
  return <DemoContext.Provider value={{ meta, resetCount, afterReset }}>{children}</DemoContext.Provider>;
}

export const useDemo = () => useContext(DemoContext);
