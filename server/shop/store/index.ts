import type { Stock } from '../types.js';
/** Phase 2 read-only boundary. Replaced by the journaled ledger in Phase 3. */
export interface ShopStockReader { getStock(variantIds: string[]): Promise<Stock> }
export const temporaryShopStore: ShopStockReader = { async getStock() { return {}; } };
