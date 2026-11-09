import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.js';
import { freshKey, record, type ContentDoc } from '../state/content.js';
export function generateVariants(existing: Record<string, unknown>[], groups: string[], colors: string[]): Record<string, unknown>[] {
  const presets: Record<string, string[]> = { youth: ['XS', 'S', 'M', 'L', 'XL'], adult: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'], 'one-size': ['One size'] };
  const next = [...existing];
  for (const group of groups) for (const size of presets[group] ?? []) for (const color of colors.length ? colors : ['']) {
    const label = [color, group === 'one-size' ? '' : group === 'youth' ? 'Youth' : 'Adult', size].filter(Boolean).join(' ');
    if (!next.some(row => row.label === label)) next.push({ _key: freshKey(), label, group, ...(color ? { color } : {}), active: true });
  }
  return next;
}
export function CatalogTools({ collection, value, update, disabled }: { collection: string; value: Record<string, unknown>; update: (name: string, value: unknown) => void; disabled: boolean }) {
  const [groups, setGroups] = useState(['youth', 'adult']), [colors, setColors] = useState(''), [media, setMedia] = useState<ContentDoc[]>([]), [selected, setSelected] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { api<{ docs: ContentDoc[] }>('/docs/media').then(r => setMedia(r.docs.filter(d => String(record(d.draft).mime).startsWith('image/')))).catch(() => setNotice('Could not load the image library. Please reload.')); }, []);
  return <section class="card" aria-label="Catalog tools"><div class="section-heading"><div><span class="eyebrow">Catalog tools</span><h2>{collection === 'products' ? 'Build your product' : 'Bundle image'}</h2><p class="muted">Use the club image library and keep each size easy to find.</p></div></div>
    <div class="form-grid"><div class="field field-full"><label for="catalog-image">Choose an existing image</label><select id="catalog-image" disabled={disabled} value={selected} onChange={e => setSelected(e.currentTarget.value)}><option value="">Choose an image</option>{media.map(d => <option value={d.id}>{String(d.draft.filename)}</option>)}</select><button class="button secondary" disabled={disabled || !selected} onClick={() => { const image = { mediaId: selected, alt: String(media.find(d => d.id === selected)?.draft.alt ?? '') }; update(collection === 'products' ? 'images' : 'image', collection === 'products' ? [...(Array.isArray(value.images) ? value.images : []), { _key: freshKey(), image }] : image); setNotice('Image selected. Add caption and alternative text below.'); }}>Use image</button></div>
    {collection === 'products' && <><fieldset class="field field-full"><legend>Generate variants</legend><p class="muted">Add sizes with stable identities. Existing variants are kept.</p>{[['youth', 'Youth XS–XL'], ['adult', 'Adult XS–3XL'], ['one-size', 'One size']].map(([key, label]) => <label class="field-check"><input type="checkbox" disabled={disabled} checked={groups.includes(key)} onChange={e => setGroups(e.currentTarget.checked ? [...groups, key] : groups.filter(g => g !== key))} /> {label}</label>)}</fieldset><div class="field field-full"><label for="variant-colors">Colors (comma-separated, optional)</label><input id="variant-colors" value={colors} disabled={disabled} placeholder="Navy, Royal blue" onInput={e => setColors(e.currentTarget.value)} /><button class="button secondary" disabled={disabled || !groups.length} onClick={() => { update('variants', generateVariants(Array.isArray(value.variants) ? value.variants : [], groups, [...new Set(colors.split(',').map(c => c.trim()).filter(Boolean))])); setNotice('Variants added. Review their labels and prices below.'); }}>Generate variants</button></div></>}
    </div><p role="status">{notice}</p></section>;
}
