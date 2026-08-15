/**
 * Minimal warehouse / packing foundation types for KoolMovez Logistics MVP.
 *
 * Architecture (approved):
 * - Air goods stay on `air_freight_goods` (no shared logistics_goods).
 * - Sea uses parallel `sea_freight_goods` + `sea_packing_request_items`.
 * - Shared: `warehouses` + `packing_requests`.
 * - Air packing lines: `air_packing_request_items`.
 * - Freight type comes from the China receiving warehouse (CN-AIR → air).
 */

export type FreightType = 'air' | 'sea';

/** China receiving = air|sea only. Nigeria pickup may also be both. */
export type WarehouseFreightSupport = FreightType | 'both';

export type WarehouseCountry = 'china' | 'nigeria';

export type WarehouseKind = 'receiving' | 'pickup';

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  country: WarehouseCountry;
  kind: WarehouseKind;
  freight_type: WarehouseFreightSupport;
  address: string | null;
  is_active: boolean;
};

/** Packing/shipping request — Nigeria pickup + optional user packing instructions. */
export type PackingRequest = {
  id: string;
  user_id: string;
  km_id: string;
  freight_type: FreightType;
  china_warehouse_id: string | null;
  nigeria_pickup_warehouse_id: string;
  /** User free-text packing instructions (separate from admin shipment remarks). */
  user_packing_instructions: string | null;
  shipment_id: string | null;
  status: string;
  created_at: string;
};

export function freightTypeFromReceivingWarehouse(
  warehouse: Pick<Warehouse, 'kind' | 'freight_type' | 'country'>
): FreightType {
  if (warehouse.kind !== 'receiving' || warehouse.country !== 'china') {
    throw new Error('Freight type is determined only by a China receiving warehouse.');
  }
  if (warehouse.freight_type === 'both') {
    throw new Error('China receiving warehouses must be Air or Sea only.');
  }
  return warehouse.freight_type;
}

export function warehouseSupportsFreight(
  warehouse: Pick<Warehouse, 'freight_type'>,
  freight: FreightType
): boolean {
  return warehouse.freight_type === freight || warehouse.freight_type === 'both';
}

export function isChinaReceivingWarehouse(
  warehouse: Pick<Warehouse, 'country' | 'kind'>
): boolean {
  return warehouse.country === 'china' && warehouse.kind === 'receiving';
}

export function isNigeriaPickupWarehouse(
  warehouse: Pick<Warehouse, 'country' | 'kind'>
): boolean {
  return warehouse.country === 'nigeria' && warehouse.kind === 'pickup';
}

export function normalizeWarehouse(row: Record<string, any>): Warehouse {
  return {
    id: String(row.id),
    code: String(row.code ?? ''),
    name: String(row.name ?? ''),
    country: row.country === 'nigeria' ? 'nigeria' : 'china',
    kind: row.kind === 'pickup' ? 'pickup' : 'receiving',
    freight_type:
      row.freight_type === 'sea' ? 'sea' : row.freight_type === 'both' ? 'both' : 'air',
    address: row.address ?? null,
    is_active: row.is_active !== false,
  };
}
