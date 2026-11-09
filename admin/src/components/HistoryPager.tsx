import { useEffect, useRef } from 'preact/hooks';
export function HistoryPager({ loading, error, more, load, infinite = false }: { loading: boolean; error: string; more?: string; load: () => void; infinite?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!infinite || !more || loading || error || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load(); }, { rootMargin: '180px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [more, loading, error, infinite, load]);
  return <div class="history-pager" ref={ref}>{loading && <p role="status">Loading history…</p>}{error && <p class="error-box" role="alert">{error}</p>}{!loading && (more || error) && <button class="button secondary" onClick={load}>{error ? 'Retry loading' : 'Load more'}</button>}</div>;
}
