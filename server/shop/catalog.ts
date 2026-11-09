import type { CollectionName } from '../../shared/schema.js';
import type { Doc, ValidationIssue } from '../../shared/types.js';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(object) : [];
export function validateCatalog(collection: CollectionName, value: unknown, options: { id?: string; documents?: Doc[]; resolve?: (collection: CollectionName, id: string) => Doc | null }): ValidationIssue[] {
  const d = object(value), errors: ValidationIssue[] = [], add = (path: string, message: string) => errors.push({ path, message });
  if (['products', 'bundles', 'categories'].includes(collection)) {
    if (['cart', 'checkout', 'orders', 'order', 'p', 'b', 'c'].includes(String(d.slug))) add('slug', 'This slug is reserved');
    if (options.documents?.some(doc => doc.collection === collection && doc.id !== options.id && !doc.trashedAt && doc.published !== undefined && object(doc.published).slug === d.slug)) add('slug', 'Slug must be unique in this collection');
  }
  if (collection === 'products') {
    const variants = list(d.variants), labels = new Set<unknown>();
    variants.forEach((v, i) => { if (labels.has(v.label)) add(`variants[${i}].label`, 'Variant labels must be unique'); labels.add(v.label); });
    if (!variants.some(v => v.active !== false)) add('variants', 'At least one variant must be active');
    const preorder = object(d.preorder);
    if (preorder.opensAt && preorder.closesAt && Date.parse(String(preorder.closesAt)) <= Date.parse(String(preorder.opensAt))) add('preorder.closesAt', 'Must be after opensAt');
  }
  if (collection === 'bundles') list(d.components).forEach((v, i) => {
    const product = options.resolve?.('products', String(v.productId));
    if (!product || product.published === undefined || product.trashedAt || product.status === 'trashed') add(`components[${i}].productId`, 'Bundle components must reference published, non-trashed products');
    else if (v.fixedVariantKey && !list(object(product.published).variants).some(x => x._key === v.fixedVariantKey)) add(`components[${i}].fixedVariantKey`, 'Variant must exist on the component product');
  });
  if (collection === 'storeSettings' && d.enabled === true) {
    if (!object(d.offline).enabled && !object(d.card).enabled) add('offline.enabled', 'Enable at least one payment method');
    if (!object(d.shipping).enabled && !(object(d.pickup).enabled && list(object(d.pickup).options).some(o => o.active === true))) add('pickup.options', 'Enable shipping or an active pickup option');
    if (!d.contactEmail) add('contactEmail', 'A contact email is required to enable the store');
  }
  return errors;
}
