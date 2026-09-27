import { DomainError, type Db } from '@training/core';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmRequest } from '../components/ConfirmDialog.tsx';
import type { Platform } from './platform.ts';

interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

interface AppContextValue {
  platform: Platform;
  toast(text: string, kind?: Toast['kind']): void;
  confirm(req: ConfirmRequest): Promise<boolean>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext manquant');
  return ctx;
}

export const useDb = (): Db => useApp().platform.db;

/** Message lisible pour l'utilisateur, quelle que soit l'origine de l'erreur. */
export function errorMessage(err: unknown): string {
  if (err instanceof DomainError) return err.message;
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Erreur inattendue.';
}

/**
 * Exécute une écriture en base, affiche l'erreur éventuelle et rafraîchit les données.
 * Retourne le résultat, ou `undefined` en cas d'échec.
 */
export function useAction() {
  const { platform, toast } = useApp();
  const qc = useQueryClient();
  return useCallback(
    async <T,>(fn: (db: Db) => Promise<T>, successMessage?: string): Promise<T | undefined> => {
      try {
        const r = await fn(platform.db);
        if (successMessage) toast(successMessage);
        return r;
      } catch (err) {
        console.error(err);
        toast(errorMessage(err), 'error');
        return undefined;
      } finally {
        await qc.invalidateQueries();
      }
    },
    [platform, toast, qc],
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
});

function ExternalChangeListener() {
  const { platform, toast } = useApp();
  const qc = useQueryClient();
  useEffect(
    () =>
      platform.onExternalChange(() => {
        void qc.invalidateQueries();
        toast('Données mises à jour depuis Claude Desktop.');
      }),
    [platform, qc, toast],
  );
  return null;
}

export function AppProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReq, setConfirmReq] = useState<(ConfirmRequest & { resolve(v: boolean): void }) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const confirm = useCallback(
    (req: ConfirmRequest) => new Promise<boolean>((resolve) => setConfirmReq({ ...req, resolve })),
    [],
  );

  const value = useMemo(() => ({ platform, toast, confirm }), [platform, toast, confirm]);

  return (
    <QueryClientProvider client={queryClient}>
      <AppContext.Provider value={value}>
        <ExternalChangeListener />
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>
        {confirmReq && (
          <ConfirmDialog
            {...confirmReq}
            onClose={(ok) => {
              confirmReq.resolve(ok);
              setConfirmReq(null);
            }}
          />
        )}
      </AppContext.Provider>
    </QueryClientProvider>
  );
}
