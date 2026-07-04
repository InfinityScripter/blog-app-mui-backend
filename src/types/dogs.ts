// Dogs-teacher cross-channel contracts.

/** Payload delivered to the service worker's `push` handler on the client. */
export interface DogsPushPayload {
  title: string;
  body: string;
  url: string;
}
