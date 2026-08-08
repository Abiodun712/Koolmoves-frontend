import { z } from 'zod';

// 1. Selection Arrays for the Form Dropdowns (Commercial Goods Removed!)
export const SHIPPING_METHODS = [
  'Air Cargo',
  'Sea Cargo',
  'Express',
  'Sensitive Goods'
] as const;

export const CATEGORIES = [
  'Electronics',
  'Fashion',
  'Furniture',
  'Machinery',
  'Cosmetics',
  'Food',
  'Accessories',
  'Others'
] as const;

// 2. Form Input Validation Schema via Zod
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

// 3. TypeScript Type Inferences
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
