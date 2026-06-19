import { Hono } from "hono";
import { z } from "zod";

import {
  WebhookManager,
  type WebhookManagerOptions,
  WEBHOOK_EVENT_TYPES,
  isValidEventType,
  type WebhookEventType,
} from "@prooflink/core";
import { requireScope } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const RegisterWebhookRequest = z.object({
  url: z.string().url(),
  secret: z.string().min(16, "Secret must be at least 16 characters"),
  events: z.array(z.string()).default([]),
});

const UpdateWebhookRequest = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

const WebhookIdParams = z.object({
  id: z.string().uuid("Invalid webhook ID format."),
});

// ---------------------------------------------------------------------------
// Singleton manager -- in production this would be backed by a DB
// ---------------------------------------------------------------------------

let manager: WebhookManager | null = null;

export function getWebhookManager(opts?: WebhookManagerOptions): WebhookManager {
  if (!manager) {
    manager = new WebhookManager(opts);
  }
  return manager;
}

/** Reset manager -- for testing only. */
export function resetWebhookManager(): void {
  manager = null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function validateEventTypes(events: string[]): string[] {
  return events.filter((e) => !isValidEventType(e));
}

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const webhookRoutes = new Hono();

// POST /v1/webhooks -- Register a webhook
webhookRoutes.post("/", requireScope("write"), validate({ body: RegisterWebhookRequest }), async (c) => {
  const parsed = c.get("validatedBody") as z.infer<typeof RegisterWebhookRequest>;

  // Validate event types
  const invalidEvents = validateEventTypes(parsed.events);
  if (invalidEvents.length > 0) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid event types: ${invalidEvents.join(", ")}`,
          validTypes: WEBHOOK_EVENT_TYPES,
        },
      },
      400,
    );
  }

  const mgr = getWebhookManager();
  const config = mgr.register(
    parsed.url,
    parsed.secret,
    parsed.events as WebhookEventType[],
  );

  return c.json(
    {
      success: true,
      data: {
        id: config.id,
        url: config.url,
        events: config.events,
        active: config.active,
        createdAt: config.createdAt,
      },
    },
    201,
  );
});

// GET /v1/webhooks -- List all webhooks
webhookRoutes.get("/", (c) => {
  const mgr = getWebhookManager();
  const webhooks = mgr.list().map((wh) => ({
    id: wh.id,
    url: wh.url,
    events: wh.events,
    active: wh.active,
    createdAt: wh.createdAt,
  }));

  return c.json({ success: true, data: webhooks }, 200);
});

// DELETE /v1/webhooks/:id -- Remove a webhook
webhookRoutes.delete("/:id", requireScope("write"), validate({ params: WebhookIdParams }), (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof WebhookIdParams>;

  const mgr = getWebhookManager();
  const removed = mgr.remove(id);
  if (!removed) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Webhook not found." } },
      404,
    );
  }

  return c.json({ success: true, data: { id, deleted: true } }, 200);
});

// PUT /v1/webhooks/:id -- Update a webhook
webhookRoutes.put(
  "/:id",
  requireScope("write"),
  validate({ params: WebhookIdParams, body: UpdateWebhookRequest }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof WebhookIdParams>;
    const parsed = c.get("validatedBody") as z.infer<typeof UpdateWebhookRequest>;

    // Validate event types if provided
    if (parsed.events) {
      const invalidEvents = validateEventTypes(parsed.events);
      if (invalidEvents.length > 0) {
        return c.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: `Invalid event types: ${invalidEvents.join(", ")}`,
              validTypes: WEBHOOK_EVENT_TYPES,
            },
          },
          400,
        );
      }
    }

    const mgr = getWebhookManager();
    const existing = mgr.get(id);
    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Webhook not found." } },
        404,
      );
    }

    // Remove old and re-register with merged config.
    // The WebhookManager is append-only, so we remove + re-register.
    const mergedUrl = parsed.url ?? existing.url;
    const mergedEvents = (parsed.events as WebhookEventType[]) ?? existing.events;

    mgr.remove(id);
    const newConfig = mgr.register(mergedUrl, existing.secret, mergedEvents);

    return c.json(
      {
        success: true,
        data: {
          id: newConfig.id,
          url: newConfig.url,
          events: newConfig.events,
          active: parsed.active ?? newConfig.active,
          createdAt: newConfig.createdAt,
        },
      },
      200,
    );
  },
);

// POST /v1/webhooks/:id/test -- Send a test event
webhookRoutes.post("/:id/test", requireScope("write"), validate({ params: WebhookIdParams }), async (c) => {
  const { id } = c.get("validatedParams") as z.infer<typeof WebhookIdParams>;

  const mgr = getWebhookManager();
  const webhook = mgr.get(id);
  if (!webhook) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Webhook not found." } },
      404,
    );
  }

  // Dispatch a test event
  const records = await mgr.dispatch("compliance.check.passed", {
    test: true,
    message: "This is a test webhook delivery from ProofLink.",
    webhookId: id,
  });

  const delivery = records.find((r) => r.webhookId === id);

  return c.json(
    {
      success: true,
      data: {
        delivered: delivery?.success ?? false,
        attempts: delivery?.attempts.length ?? 0,
        lastStatus: delivery?.attempts.at(-1)?.status ?? null,
      },
    },
    200,
  );
});

export { webhookRoutes };
