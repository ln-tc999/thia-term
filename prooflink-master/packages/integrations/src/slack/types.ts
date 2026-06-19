// ---------------------------------------------------------------------------
// Slack — types
// ---------------------------------------------------------------------------

/** Configuration for the Slack webhook notifier. */
export interface SlackConfig {
  /** Slack incoming webhook URL */
  webhookUrl: string;
  /** Channel override (optional — webhook default channel is used if omitted) */
  channel?: string;
  /** Bot username override */
  username?: string;
  /** Bot icon emoji (e.g., ":shield:") */
  iconEmoji?: string;
  /** Request timeout in milliseconds (default: 5_000) */
  timeoutMs?: number;
}

/** Slack Block Kit block element. */
export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
  accessory?: Record<string, unknown>;
}

/** Slack attachment with optional Block Kit blocks. */
export interface SlackAttachment {
  color?: string;
  fallback?: string;
  blocks?: SlackBlock[];
}

/** Slack message payload. */
export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  channel?: string;
  username?: string;
  icon_emoji?: string;
}

/** HTTP client interface for Slack webhook calls (injectable for testing). */
export interface SlackHttpClient {
  fetch(url: string, init: RequestInit): Promise<Response>;
}
