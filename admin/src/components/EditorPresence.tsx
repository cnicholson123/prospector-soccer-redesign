import { useEffect, useState } from 'preact/hooks';
import type { CollectionName } from '../../../shared/schema.js';
import { heartbeat as sendHeartbeat } from '../state/presence.js';
export function EditorPresence({ collection, id }: { collection: CollectionName; id: string }) {
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]), [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    async function heartbeat() {
      if (document.visibilityState === 'hidden') return;
      try { const data = await sendHeartbeat(collection, id); if (active) { setOthers(data.others); setUnavailable(false); } } catch { if (active) { setOthers([]); setUnavailable(true); } }
    }
    void heartbeat(); const timer = setInterval(() => void heartbeat(), 30000);
    return () => { active = false; clearInterval(timer); };
  }, [collection, id]);
  return <p class="presence" role="status">{unavailable ? 'Editing presence is temporarily unavailable.' : others.length ? `Also editing: ${others.map(p => p.name).join(', ')}` : 'No other editors seen on this server.'}</p>;
}
