import { describe, expect, it } from 'vitest';
import { deliveryStatusLabel } from './telegramStatus';

describe('deliveryStatusLabel', () => {
  it('says delivered only for a sent Telegram message', () => {
    expect(deliveryStatusLabel('sent')).toEqual({ label: 'Delivered to Telegram', delivered: true });
    for (const status of ['queued', 'sending', 'failed', 'needs_review', 'cancelled', 'preview', 'stored', 'disabled', '']) {
      const label = deliveryStatusLabel(status);
      expect(label.delivered).toBe(false);
      expect(label.label.toLowerCase()).toContain('not delivered');
    }
  });

  it('distinguishes an admin attestation from a Telegram delivery', () => {
    expect(deliveryStatusLabel('sent', 'marked_by_admin').label).toContain('No new Telegram call');
    expect(deliveryStatusLabel('queued', 'marked_by_admin').delivered).toBe(false);
  });
});
