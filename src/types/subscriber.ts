// Public newsletter-subscriber DTO. Secret columns (confirm_token,
// unsubscribe_token, confirm_expires_at) are never mapped into this contract.
// The service lives in src/services/subscriber.ts.

export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed';

export interface Subscriber {
  id: string;
  email: string;
  status: SubscriberStatus;
  createdAt: string;
  confirmedAt: string | null;
}
