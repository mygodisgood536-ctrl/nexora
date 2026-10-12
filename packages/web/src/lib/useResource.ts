import { useCallback, useEffect, useRef, useState } from "react";
import { http } from "./api";

/**
 * Minimal list-resource loader used by every table page:
 * GET path?params -> {items(rows), total}, with search + pagination.
 * Errors surface as a string so pages can render honest empty/error states.
 */
export interface ListState<T> {
  rows: T[];
  total: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useList<T = Record<string, unknown>>(
  path: string,
  options: { params?: Record<string, string | number | boolean | undefined>; page?: number; pageSize?: number } = {}
): ListState<T> {
  const { params, page = 1, pageSize = 25 } = options;
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const serial = useRef(0);

  const key = JSON.stringify({ path, params });

  useEffect(() => {
    const q = new URLSearchParams();
    q.set("limit", String(pageSize));
    q.set("offset", String((page - 1) * pageSize));
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const req = { params: q };
    setLoading(true);
    setError(null);
    const cur = ++serial.current;
    http
      .get<{ items?: T[]; total?: number } | T[]>(path, req)
      .then((res) => {
        if (cur !== serial.current) return;
        const body = res as { items?: T[]; total?: number } | T[];
        if (Array.isArray(body)) {
          setRows(body);
          setTotal(body.length);
          return;
        }
        setRows(Array.isArray(body?.items) ? body.items : []);
        setTotal(body?.total ?? 0);
      })
      .catch((err: unknown) => {
        if (cur !== serial.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cur === serial.current) setLoading(false);
      });
    // deps are keyed by the caller's `key`/id arguments.
  }, [path, key, page, pageSize, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, total, loading, error, reload };
}

/** Single-resource loader (detail pages). */
export function useResource<T = Record<string, unknown>>(loader: () => Promise<unknown>, deps: unknown[] = []): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const serial = useRef(0);

  useEffect(() => {
    const cur = ++serial.current;
    setLoading(true);
    setError(null);
    loader()
      .then((res) => {
        if (cur === serial.current) setData(res as T);
      })
      .catch((err: unknown) => {
        if (cur === serial.current) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cur === serial.current) setLoading(false);
      });
    // deps are keyed by the caller's dependencies.
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}