import type { PublishMode } from '../components/PublishButton.js';
import { collections, type CollectionName } from '../../../shared/schema.js';
import { DocEditor } from './DocEditor.js';
export function PageEditor({ page, publish, refresh }: { page: string; publish: (mode?: PublishMode) => void; refresh: number }) {
  const collection = (page === 'sponsors' ? 'sponsorsPage' : page === 'shop' ? 'shopPage' : page) as CollectionName;
  if (!collections[collection] || collections[collection].kind !== 'singleton') return <div class="card empty-state"><h1>Page not found</h1><a href="/admin/pages">All pages</a></div>;
  return <DocEditor key={collection} id={collection} collection={collection} publish={publish} refresh={refresh} />;
}
