import { INDICATIVE_RATE_NOTE } from '../../src/lib/publishedExchangeRate';

export const MENU_INTRO = [
  'KoolMovez',
  'Exchange Naira for RMB, and move goods from China to Nigeria by Air or Sea, on the KoolMovez website.',
  'This chat can point you to the website and take a message for a person. It does not quote a live rate, list a policy FAQ, or approve a payment.',
].join('\n');

export const SUPPORT_OPENED = [
  'A person on the KoolMovez team can read the next message you send in this chat.',
  'Sending it does not approve a payment or change a request.',
  'There is no policy FAQ in this chat. Exchange, freight, packing, and clearing costs stay on the website.',
].join('\n');

export const SUPPORT_ALREADY =
  'You already have an open support request. Your next message is added to that request. It does not approve a payment.';

export const SUPPORT_SAVED =
  'Your message is in the support inbox for a person to review. It is not an approval, and this chat has not delivered a reply.';

export const SUPPORT_NOT_A_TICKET =
  'That message was not sent to support. Tap Talk to support first if you want a person to read it.';

export const TEXT_ONLY = 'Send a text message. This chat does not read photos, files, or payment receipts.';

export function exchangeHelp(siteUrl: string): string {
  return [
    'Exchange Naira for RMB through your KoolMovez account.',
    'The website shows the current published rate. This chat does not quote a rate.',
    INDICATIVE_RATE_NOTE,
    `Sign in: ${siteUrl}/login`,
    `Exchange: ${siteUrl}/dashboard`,
  ].join('\n');
}

export function logisticsHelp(siteUrl: string): string {
  return [
    'Move goods from China to Nigeria by Air Freight or Sea Freight.',
    'See the applicable freight, packing and clearing/landing costs in your account.',
    'This chat does not book a shipment.',
    `Sign in: ${siteUrl}/login`,
    `Air Freight: ${siteUrl}/air-freight`,
    `Sea Freight: ${siteUrl}/sea-freight`,
  ].join('\n');
}

export function trackHelp(siteUrl: string): string {
  return [
    'This chat cannot look up a request.',
    'Sign in with your KoolMovez account. Exchange history is on the exchange page. Shipment status is on Air Freight and Sea Freight.',
    `Sign in: ${siteUrl}/login`,
    `Exchange: ${siteUrl}/dashboard`,
    `Air Freight: ${siteUrl}/air-freight`,
    `Sea Freight: ${siteUrl}/sea-freight`,
  ].join('\n');
}

export function broadcastBody(siteUrl: string, rateLine: string): string {
  return ['KoolMovez published rate', rateLine, INDICATIVE_RATE_NOTE, `${siteUrl}/`].join('\n');
}

export function exchangeAlert(siteUrl: string, reference: string, status: string): string {
  const heading = status === 'pending' ? 'New exchange request' : 'Exchange request';
  return [
    heading,
    `Ref: ${reference}`,
    'Type: exchange',
    `Status: ${status}`,
    `Admin: ${siteUrl}/admin`,
  ].join('\n');
}

export function logisticsAlert(
  siteUrl: string,
  reference: string,
  status: string,
  freightType: string,
): string {
  const heading = status === 'pending_packing' ? 'New logistics request' : 'Logistics request';
  return [
    heading,
    `Ref: ${reference}`,
    'Type: logistics',
    `Mode: ${freightType}`,
    `Status: ${status}`,
    `Admin: ${siteUrl}/admin/shipping-requests`,
  ].join('\n');
}

export function menuKeyboard(): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return {
    inline_keyboard: [
      [
        { text: 'Exchange', callback_data: 'exchange' },
        { text: 'Logistics', callback_data: 'logistics' },
      ],
      [
        { text: 'Track my request', callback_data: 'track' },
        { text: 'Talk to support', callback_data: 'support' },
      ],
    ],
  };
}
