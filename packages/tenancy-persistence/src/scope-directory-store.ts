import {
  createScopeDirectoryFromRows,
  type ScopeBindingRow,
  type ScopeDirectory,
} from '@expadio/tenancy';

export interface ProductScopeBindingRepository {
  listActiveBindings(): Promise<readonly ScopeBindingRow[]>;
}

/**
 * Load the shared T/B/L directory from persisted rows.
 * Empty result stays fail-closed inside createScopeDirectory.
 * This is not a live CRM read and does not talk to /api/tenant.
 */
export async function loadScopeDirectory(
  repository: ProductScopeBindingRepository,
): Promise<ScopeDirectory> {
  return createScopeDirectoryFromRows(await repository.listActiveBindings());
}
