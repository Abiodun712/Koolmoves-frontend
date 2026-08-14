/**
 * Logistics shipment types (Shipment & Costing Foundation).
 * Separate from any legacy booking form schemas.
 */

import { z } from 'zod';
import type { FreightType } from './warehouse';

export type LogisticsShipmentStatus =
  | 'draft'
  | 'assigned'
  | 'packing'
  | 'packed'
  | 'finalized'
  | 'in_transit'
  | 'arrived_nigeria'
  | 'ready_for_pickup'
  | 'completed'
  | 'cancelled';

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
  packing_fee: number;
  landing_cost: number;
  rate_per_kg: number | null;
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
    packing_fee: row.packing_fee != null ? Number(row.packing_fee) : 0,
    landing_cost: row.landing_cost != null ? Number(row.landing_cost) : 0,
    rate_per_kg: row.rate_per_kg != null ? Number(row.rate_per_kg) : null,
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
