export const MINUTE_MS = 60_000;

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let id: number | undefined;
  return (...args: Parameters<T>) => {
    if (id) window.clearTimeout(id);
    id = window.setTimeout(() => fn(...args), ms) as unknown as number;
  };
}

export function throttle<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let last = 0;
  let tid: number | undefined;
  let pending: Parameters<T> | null = null;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else {
      pending = args;
      if (!tid) {
        const wait = ms - (now - last);
        tid = window.setTimeout(() => {
          tid = undefined;
          last = Date.now();
          if (pending) {
            fn(...pending);
            pending = null;
          }
        }, wait) as unknown as number;
      }
    }
  };
}
