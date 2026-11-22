export function deliveryStatusLabel(status: string, lastError?: string | null): { label: string; delivered: boolean } {
  if (status === 'sent' && lastError === 'marked_by_admin') {
    return {
      label: 'Marked delivered by an admin. No new Telegram call was made.',
      delivered: true,
    };
  }
  switch (status) {
    case 'sent':
      return { label: 'Delivered to Telegram', delivered: true };
    case 'queued':
      return { label: 'Queued. Not delivered.', delivered: false };
    case 'sending':
      return { label: 'Sending. Not delivered.', delivered: false };
    case 'failed':
      return { label: 'Failed. Not delivered.', delivered: false };
    case 'needs_review':
      return { label: 'Not confirmed by Telegram. Not delivered.', delivered: false };
    case 'cancelled':
      return { label: 'Cancelled. Not delivered.', delivered: false };
    case 'preview':
      return { label: 'Preview only. Not delivered.', delivered: false };
    case 'stored':
      return { label: 'Saved in the admin inbox. Not delivered.', delivered: false };
    case 'disabled':
      return { label: 'Telegram is off. Not delivered.', delivered: false };
    default:
      return { label: 'Not delivered.', delivered: false };
  }
}
