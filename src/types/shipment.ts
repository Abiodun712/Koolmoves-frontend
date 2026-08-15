/**
 * Logistics shipment types (Shipment & Costing Foundation).
 * Separate from any legacy booking form schemas.
 */

import { z } from 'zod';
import type { FreightType } from './warehouse';

/**
 * Shared shipment statuses. Payment Required/Submitted/Confirmed are NOT
 * shipment statuses (separate task). Air must not use in_transit; Sea may.
 */
export const LOGISTICS_SHIPMENT_STATUSES = [
  'draft',
  'assigned',
  'packing',
  'packed',
  'finalized',
  'shipped',
  'in_transit',
  'arrived_nigeria',
  'ready_for_pickup',
  'completed',
  'cancelled',
] as const;

export type LogisticsShipmentStatus = (typeof LOGISTICS_SHIPMENT_STATUSES)[number];

export const AIR_SHIPMENT_STATUSES = LOGISTICS_SHIPMENT_STATUSES.filter(
  (status): status is Exclude<LogisticsShipmentStatus, 'in_transit'> =>
    status !== 'in_transit'
);

export const SEA_SHIPMENT_STATUSES: readonly LogisticsShipmentStatus[] =
  LOGISTICS_SHIPMENT_STATUSES;

export function shipmentStatusAllowed(
  freightType: FreightType,
  status: string
): status is LogisticsShipmentStatus {
  if (freightType === 'air' && status === 'in_transit') return false;
  return (LOGISTICS_SHIPMENT_STATUSES as readonly string[]).includes(status);
}

/** Costing/finalize is only for pre-finalize Air/Sea headers. */
export function shipmentAllowsCosting(status: LogisticsShipmentStatus): boolean {
  return (
    status === 'draft' ||
    status === 'assigned' ||
    status === 'packing' ||
    status === 'packed'
  );
}

/**
 * Next admin progression step after finalize (not pickup completion).
 * Air: finalized → shipped → arrived_nigeria → ready_for_pickup (never in_transit).
 * Air completed is a separate payment-gated action from ready_for_pickup.
 * Sea: finalized → shipped → in_transit → arrived_nigeria → ready_for_pickup.
 */
export function nextShipmentProgressionStatus(
  freightType: FreightType,
  current: LogisticsShipmentStatus
): LogisticsShipmentStatus | null {
  if (freightType === 'sea') {
    if (current === 'finalized') return 'shipped';
    if (current === 'shipped') return 'in_transit';
    if (current === 'in_transit') return 'arrived_nigeria';
    if (current === 'arrived_nigeria') return 'ready_for_pickup';
    return null;
  }

  if (current === 'finalized') return 'shipped';
  if (current === 'shipped') return 'arrived_nigeria';
  if (current === 'arrived_nigeria') return 'ready_for_pickup';
  return null;
}

export function shipmentProgressionAllowed(
  freightType: FreightType,
  from: LogisticsShipmentStatus,
  to: LogisticsShipmentStatus
): boolean {
  if (!shipmentStatusAllowed(freightType, to)) return false;
  if (to === 'completed') return false;
  return nextShipmentProgressionStatus(freightType, from) === to;
}

export function shipmentProgressionActionLabel(next: LogisticsShipmentStatus): string {
  if (next === 'shipped') return 'Mark as Shipped';
  if (next === 'in_transit') return 'Mark In Transit';
  if (next === 'arrived_nigeria') return 'Mark Arrived in Nigeria';
  if (next === 'ready_for_pickup') return 'Mark Available for Pickup';
  return `Mark as ${next}`;
}

/** User-facing Air progress. Never includes in_transit. */
export const AIR_USER_PROGRESS_STEPS = [
  { status: 'finalized', label: 'Finalized' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'arrived_nigeria', label: 'Arrived Nigeria' },
  { status: 'ready_for_pickup', label: 'Available for Pickup' },
] as const;

/** 0–3 when on/after a user-facing Air step; -1 before finalize. Never an In Transit step. */
export function airUserProgressIndex(status: LogisticsShipmentStatus): number {
  if (status === 'completed') return AIR_USER_PROGRESS_STEPS.length - 1;
  if (status === 'in_transit') return 1;
  return AIR_USER_PROGRESS_STEPS.findIndex((step) => step.status === status);
}

export function airShipmentStatusLabel(status: LogisticsShipmentStatus): string {
  if (status === 'assigned') return 'Shipment created';
  if (status === 'packing') return 'Packing';
  if (status === 'packed') return 'Packed';
  if (status === 'finalized') return 'Finalized';
  if (status === 'shipped' || status === 'in_transit') return 'Shipped';
  if (status === 'arrived_nigeria') return 'Arrived Nigeria';
  if (status === 'ready_for_pickup') return 'Available for Pickup';
  if (status === 'completed') return 'Completed / Picked Up';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'draft') return 'Draft';
  return status;
}

/** User-facing Sea progress. Includes In Transit. */
export const SEA_USER_PROGRESS_STEPS = [
  { status: 'finalized', label: 'Finalized' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'in_transit', label: 'In Transit' },
  { status: 'arrived_nigeria', label: 'Arrived Nigeria' },
  { status: 'ready_for_pickup', label: 'Available for Pickup' },
] as const;

export function seaUserProgressIndex(status: LogisticsShipmentStatus): number {
  if (status === 'completed') return SEA_USER_PROGRESS_STEPS.length - 1;
  return SEA_USER_PROGRESS_STEPS.findIndex((step) => step.status === status);
}

export function seaShipmentStatusLabel(status: LogisticsShipmentStatus): string {
  if (status === 'assigned') return 'Shipment created';
  if (status === 'packing') return 'Packing';
  if (status === 'packed') return 'Packed';
  if (status === 'finalized') return 'Finalized';
  if (status === 'shipped') return 'Shipped';
  if (status === 'in_transit') return 'In Transit';
  if (status === 'arrived_nigeria') return 'Arrived Nigeria';
  if (status === 'ready_for_pickup') return 'Available for Pickup';
  if (status === 'completed') return 'Completed / Picked Up';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'draft') return 'Draft';
  return status;
}

export function seaShipmentRevealsPickupAddress(shipment: {
  status: LogisticsShipmentStatus;
  finalized_at: string | null;
}): boolean {
  if (shipment.finalized_at) return true;
  return (
    shipment.status === 'finalized' ||
    shipment.status === 'shipped' ||
    shipment.status === 'in_transit' ||
    shipment.status === 'arrived_nigeria' ||
    shipment.status === 'ready_for_pickup' ||
    shipment.status === 'completed'
  );
}

/** Air pickup address after finalize / later Air stages (no in_transit). */
export function airShipmentRevealsPickupAddress(shipment: {
  status: LogisticsShipmentStatus;
  finalized_at: string | null;
}): boolean {
  if (shipment.finalized_at) return true;
  return (
    shipment.status === 'finalized' ||
    shipment.status === 'shipped' ||
    shipment.status === 'arrived_nigeria' ||
    shipment.status === 'ready_for_pickup' ||
    shipment.status === 'completed'
  );
}

export type LogisticsShipment = {
  id: string;
  shipment_code: string;
  freight_type: FreightType;
  status: LogisticsShipmentStatus;
  user_id: string;
  km_id: string;
  packing_request_id: string | null;
  china_warehouse_id: string | null;
  nigeria_pickup_warehouse_id: string;
  departure_date: string | null;
  estimated_arrival: string | null;
  final_packed_weight_kg: number | null;
  final_packed_cbm: number | null;
  packing_fee: number;
  landing_cost: number;
  rate_per_kg: number | null;
  rate_per_cbm: number | null;
  freight_charge: number | null;
  total_amount_due: number | null;
  admin_shipment_remarks: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeLogisticsShipment(row: Record<string, any>): LogisticsShipment {
  return {
    id: String(row.id),
    shipment_code: String(row.shipment_code ?? ''),
    freight_type: row.freight_type === 'sea' ? 'sea' : 'air',
    status: (row.status as LogisticsShipmentStatus) || 'draft',
    user_id: String(row.user_id),
    km_id: String(row.km_id ?? ''),
    packing_request_id: row.packing_request_id ? String(row.packing_request_id) : null,
    china_warehouse_id: row.china_warehouse_id ? String(row.china_warehouse_id) : null,
    nigeria_pickup_warehouse_id: String(row.nigeria_pickup_warehouse_id),
    departure_date: row.departure_date ?? null,
    estimated_arrival: row.estimated_arrival ?? null,
    final_packed_weight_kg:
      row.final_packed_weight_kg != null ? Number(row.final_packed_weight_kg) : null,
    final_packed_cbm: row.final_packed_cbm != null ? Number(row.final_packed_cbm) : null,
    packing_fee: row.packing_fee != null ? Number(row.packing_fee) : 0,
    landing_cost: row.landing_cost != null ? Number(row.landing_cost) : 0,
    rate_per_kg: row.rate_per_kg != null ? Number(row.rate_per_kg) : null,
    rate_per_cbm: row.rate_per_cbm != null ? Number(row.rate_per_cbm) : null,
    freight_charge: row.freight_charge != null ? Number(row.freight_charge) : null,
    total_amount_due: row.total_amount_due != null ? Number(row.total_amount_due) : null,
    admin_shipment_remarks: row.admin_shipment_remarks ?? null,
    finalized_at: row.finalized_at ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/** Legacy unused booking form — kept so existing imports do not break. */
export const SHIPPING_METHODS = [
  'Air Cargo',
  'Sea Cargo',
  'Express',
  'Sensitive Goods',
] as const;

export const CATEGORIES = [
  'Electronics',
  'Fashion',
  'Furniture',
  'Machinery',
  'Cosmetics',
  'Food',
  'Accessories',
  'Others',
] as const;

export const createShipmentSchema = z.object({
  supplier_name: z.string().min(2, 'Supplier name is required.'),
  supplier_phone: z.string().min(5, 'Supplier phone contact is required.'),
  supplier_address: z.string().min(6, 'Please provide an explicit supplier address.'),
  tracking_number: z.string().optional(),
  courier_name: z.string().min(2, 'Inbound domestic courier name required.'),
  shipping_method: z.enum(SHIPPING_METHODS),
  description: z.string().min(4, 'Detailed contents description required.'),
  category: z.enum(CATEGORIES),
  quantity: z.number().int().positive('Quantity must be 1 or greater.'),
  declared_value: z.number().positive('Declared customs value must be greater than 0.'),
  currency: z.string().default('USD'),
  estimated_weight: z.number().positive('Estimated package weight must be greater than 0.'),
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  special_instruction: z.string().optional(),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

export type ShipmentStatus =
  | 'Pending'
  | 'Awaiting Warehouse Arrival'
  | 'Received at China Warehouse'
  | 'Inspecting'
  | 'Awaiting Consolidation'
  | 'Consolidated'
  | 'Awaiting Payment'
  | 'Ready for Shipping'
  | 'In Transit'
  | 'Arrived Nigeria'
  | 'Out for Delivery'
  | 'Completed'
  | 'Cancelled'
  | 'Hold';
