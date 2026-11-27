export type AlertKind = 'exchange_request' | 'logistics_request' | 'support_request';

export type DeliveryStatus =
  | 'stored'
  | 'preview'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'needs_review'
  | 'cancelled';

export type Ticket = {
  id: string;
  chatId: string;
  telegramUserId: string | null;
  status: 'open' | 'closed';
  createdFromUpdateId: number;
  createdAt: number;
  updatedAt: number;
};

export type SupportMessage = {
  id: string;
  ticketId: string;
  chatId: string;
  direction: 'inbound' | 'outbound';
  body: string;
  telegramUpdateId: number | null;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: number | null;
  claimedAt: number | null;
  telegramMessageId: string | null;
  authorAdminId: string | null;
  lastError: string | null;
  createdAt: number;
};

export type AlertRow = {
  id: string;
  dedupeKey: string;
  kind: AlertKind;
  recordKey: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: number | null;
  claimedAt: number | null;
  deliveredChatIds: string[];
  telegramMessageId: string | null;
  lastError: string | null;
  createdAt: number;
};

export type BroadcastRow = {
  id: string;
  status: DeliveryStatus;
  body: string;
  rateLine: string;
  rateSnapshot: string;
  sourceChangeId: string | null;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: number | null;
  expiresAt: number;
  attempts: number;
  nextAttemptAt: number | null;
  claimedAt: number | null;
  telegramMessageId: string | null;
  lastError: string | null;
  createdAt: number;
};

/** One committed change of site_settings.exchange_rate. Not a delivery status. */
export type RateChangeRow = {
  id: string;
  rateValue: string;
  previousValue: string | null;
  createdBy: string | null;
  status: 'queued' | 'sending' | 'done' | 'skipped';
  broadcastId: string | null;
  claimedAt: number | null;
  createdAt: number;
};

export type RateChangeClaim =
  | { installed: false }
  | { installed: true; change: RateChangeRow | null };

export type DeliveryPatch = {
  status: DeliveryStatus;
  lastError: string | null;
  nextAttemptAt: number | null;
  claimedAt: number | null;
  telegramMessageId: string | null;
  deliveredChatIds?: string[];
};

export type StatusCounts = Record<string, number>;

export type RecentError = {
  kind: 'alert' | 'reply' | 'broadcast';
  id: string;
  status: string;
  error: string;
};

export interface TelegramStore {
  recordUpdate(updateId: number, kind: string, chatId: string | null, now: number): Promise<'inserted' | 'exists'>;
  finishUpdate(updateId: number): Promise<void>;
  updateIsOpen(updateId: number): Promise<boolean>;
  rateLimit(bucket: string, now: number, limit: number, windowMs: number): Promise<boolean>;

  openTicket(chatId: string): Promise<Ticket | null>;
  createTicket(input: {
    chatId: string;
    telegramUserId: string | null;
    updateId: number;
    now: number;
  }): Promise<Ticket | 'exists'>;
  addCustomerMessage(input: {
    ticketId: string;
    chatId: string;
    updateId: number;
    body: string;
    now: number;
  }): Promise<'created' | 'duplicate' | 'forbidden'>;
  listTickets(): Promise<Ticket[]>;
  getTicket(ticketId: string): Promise<Ticket | null>;
  listMessages(ticketId: string): Promise<SupportMessage[]>;
  closeTicket(ticketId: string, now: number): Promise<boolean>;
  queueReply(input: { ticketId: string; adminUserId: string; body: string; now: number }): Promise<SupportMessage | null>;
  claimReply(id: string, now: number): Promise<SupportMessage | null>;
  claimNextReply(now: number): Promise<SupportMessage | null>;
  settleReply(id: string, patch: DeliveryPatch): Promise<SupportMessage | null>;

  enqueueAlert(input: {
    dedupeKey: string;
    kind: AlertKind;
    recordKey: string;
    now: number;
    notBefore: number | null;
  }): Promise<'created' | 'exists'>;
  listAlerts(): Promise<AlertRow[]>;
  claimAlert(now: number): Promise<AlertRow | null>;
  claimAlertByKey(dedupeKey: string, now: number): Promise<AlertRow | null>;
  dispatchConfigured(): Promise<boolean>;
  settleAlert(id: string, patch: DeliveryPatch): Promise<AlertRow | null>;
  requeueAlert(id: string): Promise<AlertRow | null>;

  createPreview(input: {
    body: string;
    rateLine: string;
    rateSnapshot: string;
    createdBy: string;
    now: number;
    expiresAt: number;
  }): Promise<BroadcastRow>;
  getBroadcast(id: string): Promise<BroadcastRow | null>;
  listBroadcasts(): Promise<BroadcastRow[]>;
  hasInFlightBroadcast(): Promise<boolean>;
  /** Newest broadcast that was queued or sent. Previews and cancellations are ignored. */
  latestAttemptedBroadcast(): Promise<BroadcastRow | null>;
  /**
   * Records one committed rate change. Production inserts come from the database
   * trigger; tests and the service use this only to represent that row.
   */
  recordRateChange(input: {
    rateValue: string;
    previousValue: string | null;
    createdBy: string | null;
    now: number;
  }): Promise<RateChangeRow>;
  claimRateChange(now: number): Promise<RateChangeClaim>;
  /** True when a committed change is already being turned into a channel post. */
  hasSendingRateChange(): Promise<boolean>;
  finishRateChange(
    id: string,
    patch: { status: 'done' | 'skipped'; broadcastId: string | null },
  ): Promise<void>;
  /**
   * One broadcast per source change. A null source is an immediate save-path
   * post made when the change table is not installed yet.
   */
  enqueueChangedBroadcast(input: {
    sourceChangeId: string | null;
    body: string;
    rateLine: string;
    rateSnapshot: string;
    createdBy: string;
    now: number;
    expiresAt: number;
  }): Promise<BroadcastRow>;
  claimPreview(id: string, adminUserId: string, now: number): Promise<BroadcastRow | null>;
  cancelPreview(id: string, error: string, now: number): Promise<void>;
  claimBroadcastSend(id: string, now: number): Promise<BroadcastRow | null>;
  claimNextBroadcast(now: number): Promise<BroadcastRow | null>;
  settleBroadcast(id: string, patch: DeliveryPatch): Promise<BroadcastRow | null>;
  resolveBroadcast(
    id: string,
    resolution: 'not_posted' | 'posted_manually',
    now: number,
  ): Promise<BroadcastRow | null>;

  reap(now: number): Promise<void>;
  counts(): Promise<{ alerts: StatusCounts; replies: StatusCounts; broadcasts: StatusCounts }>;
  recentErrors(): Promise<RecentError[]>;
}
