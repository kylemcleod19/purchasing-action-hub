// Demo metadata (demo date, simulated clock) and a data version so pages reload after a reset or a
// simulation step.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { MetaResponse } from '../../shared/types';

interface DemoContextValue {
  meta: MetaResponse | null;
  dataVersion: number;
  /** Reloads metadata and every page's data. */
  refreshAll: () => void;
}

const DemoContext = createContext<DemoContextValue>({ meta: null, dataVersion: 0, refreshAll: () => {} });

export function DemoProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    api<MetaResponse>('/meta').then(setMeta, () => setMeta(null));
  }, [dataVersion]);

  const refreshAll = useCallback(() => setDataVersion((c) => c + 1), []);
  return <DemoContext.Provider value={{ meta, dataVersion, refreshAll }}>{children}</DemoContext.Provider>;
}

export const useDemo = () => useContext(DemoContext);
