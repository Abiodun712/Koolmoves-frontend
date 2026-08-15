export const LOGISTICS_PAYMENT_STATUSES = [
  'pending',
  'submitted',
  'confirmed',
  'rejected',
] as const;

export type LogisticsPaymentStatus = (typeof LOGISTICS_PAYMENT_STATUSES)[number];

export type LogisticsPayment = {
  id: string;
  shipment_id: string;
  user_id: string;
  status: LogisticsPaymentStatus;
  receipt_path: string | null;
  amount_due: number | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export const LOGISTICS_RECEIPT_BUCKET = 'logistics-payment-receipts';

export function normalizeLogisticsPayment(row: Record<string, any>): LogisticsPayment {
  const status = (LOGISTICS_PAYMENT_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as LogisticsPaymentStatus)
    : 'pending';
  return {
    id: String(row.id),
    shipment_id: String(row.shipment_id),
    user_id: String(row.user_id),
    status,
    receipt_path: row.receipt_path ? String(row.receipt_path) : null,
    amount_due: row.amount_due != null ? Number(row.amount_due) : null,
    submitted_at: row.submitted_at ?? null,
    confirmed_at: row.confirmed_at ?? null,
    rejected_at: row.rejected_at ?? null,
    rejection_note: row.rejection_note ?? null,
    submitted_by: row.submitted_by ? String(row.submitted_by) : null,
    reviewed_by: row.reviewed_by ? String(row.reviewed_by) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

export function logisticsPaymentStatusLabel(status: LogisticsPaymentStatus): string {
  if (status === 'pending') return 'Payment required';
  if (status === 'submitted') return 'Receipt submitted — awaiting confirmation';
  if (status === 'confirmed') return 'Payment confirmed';
  if (status === 'rejected') return 'Payment rejected';
  return status;
}

export function userMaySubmitLogisticsPayment(payment: LogisticsPayment | null): boolean {
  if (!payment) return true;
  return payment.status === 'pending' || payment.status === 'rejected';
}

/** Admin labels at ready_for_pickup. Missing payment is treated as required. */
export function airAdminPickupPaymentLabel(payment: LogisticsPayment | null | undefined): string {
  if (!payment || payment.status === 'pending') return 'Payment Required';
  if (payment.status === 'submitted') return 'Awaiting Payment Confirmation';
  if (payment.status === 'rejected') return 'Payment Rejected';
  if (payment.status === 'confirmed') return 'Payment Confirmed';
  return 'Payment Required';
}

export function airShipmentMayBeCompleted(
  shipmentStatus: string,
  payment: LogisticsPayment | null | undefined
): boolean {
  return shipmentStatus === 'ready_for_pickup' && payment?.status === 'confirmed';
}

/** Same payment gate as Air. Does not change Air completion rules. */
export function seaShipmentMayBeCompleted(
  shipmentStatus: string,
  payment: LogisticsPayment | null | undefined
): boolean {
  return airShipmentMayBeCompleted(shipmentStatus, payment);
}
