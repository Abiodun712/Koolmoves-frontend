/**
 * KoolMovez Logistics shipment costing (shipment-level only).
 *
 * Total Amount Due =
 *   (final_packed_weight_kg × rate_per_kg) + packing_fee + landing_cost
 *
 * - Final packed weight is admin-entered (never summed from item weights).
 * - Packing fee and landing cost are applied once per shipment.
 * - Do not duplicate these costs onto individual goods.
 */

export type ShipmentCostInputs = {
  finalPackedWeightKg: number;
  ratePerKg: number;
  packingFee: number;
  landingCost: number;
};

export type ShipmentCostResult = {
  freightCharge: number;
  totalAmountDue: number;
};

/** Extract the first numeric amount from published fee text (e.g. "₦8,500 / kg"). */
export function parseRatePerKgFromFeeText(feeText: string | null | undefined): number | null {
  if (!feeText) return null;
  const cleaned = feeText.replace(/,/g, '');
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function computeShipmentTotalDue(input: ShipmentCostInputs): ShipmentCostResult {
  const weight = Number(input.finalPackedWeightKg) || 0;
  const rate = Number(input.ratePerKg) || 0;
  const packingFee = Number(input.packingFee) || 0;
  const landingCost = Number(input.landingCost) || 0;

  const freightCharge = roundMoney(weight * rate);
  const totalAmountDue = roundMoney(freightCharge + packingFee + landingCost);

  return { freightCharge, totalAmountDue };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function makeShipmentCode(freightType: 'air' | 'sea'): string {
  const prefix = freightType === 'sea' ? 'KM-SEA' : 'KM-AIR';
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${yyyy}${mm}${dd}-${rand}`;
}
