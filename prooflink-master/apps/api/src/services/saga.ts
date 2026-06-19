import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { sagas } from "../db/schema.js";
import { writeAuditLog } from "../utils/audit.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SagaStepStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATING"
  | "COMPENSATED"
  | "COMPENSATION_FAILED";

export type SagaStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "COMPENSATING"
  | "COMPENSATED"
  | "FAILED";

export interface SagaStepResult {
  id: string;
  name: string;
  status: SagaStepStatus;
  result?: unknown;
  error?: string;
  compensationError?: string;
  startedAt?: string;
  completedAt?: string;
}

/** Serializable saga step definition stored in the DB jsonb column. */
export interface SagaStepRecord {
  id: string;
  name: string;
  type: SagaStepType;
  params: Record<string, unknown>;
  status: SagaStepStatus;
  result?: unknown;
  error?: string;
  compensationError?: string;
  startedAt?: string;
  completedAt?: string;
}

export type SagaStepType =
  | "complianceCheck"
  | "createEscrow"
  | "fundEscrow"
  | "createInvoice"
  | "screenAddress";

/** Runtime step with executable action/compensation closures. */
export interface SagaStepRuntime {
  id: string;
  name: string;
  action: (context: SagaContext) => Promise<unknown>;
  compensation: (context: SagaContext, result: unknown) => Promise<void>;
}

export interface SagaContext {
  sagaId: string;
  traceId: string;
  stepResults: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface SagaRecord {
  id: string;
  name: string;
  steps: SagaStepRecord[];
  status: SagaStatus;
  currentStep: number;
  traceId: string;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SagaNotFoundError extends Error {
  public readonly code = "NOT_FOUND" as const;
  constructor(id: string) {
    super(`Saga ${id} not found.`);
    this.name = "SagaNotFoundError";
  }
}

export class SagaInvalidStateError extends Error {
  public readonly code = "INVALID_STATE" as const;
  constructor(sagaId: string, current: string, expected: string) {
    super(`Saga ${sagaId} is in state ${current}, expected ${expected}.`);
    this.name = "SagaInvalidStateError";
  }
}

// ---------------------------------------------------------------------------
// Built-in step type registry — maps step type to action/compensation
// ---------------------------------------------------------------------------

type StepFactory = (params: Record<string, unknown>) => {
  action: (ctx: SagaContext) => Promise<unknown>;
  compensation: (ctx: SagaContext, result: unknown) => Promise<void>;
};

const STEP_REGISTRY: Record<SagaStepType, StepFactory> = {
  complianceCheck: (params) => ({
    action: async (_ctx) => {
      // Informational — compliance check result is returned but compensation is a no-op
      return { checked: true, ...params };
    },
    compensation: async () => {
      // No-op: compliance checks are informational
    },
  }),

  createEscrow: (params) => ({
    action: async (_ctx) => {
      // In production this calls the escrow service; here we return a placeholder
      // that routes can override with real service calls via runtime steps.
      return { escrowId: params["escrowId"] ?? `escrow-${randomUUID()}`, ...params };
    },
    compensation: async (_ctx, result) => {
      const escrowId = (result as Record<string, unknown>)?.["escrowId"];
      logger.info("Compensating: refunding escrow", { escrowId });
      // In production: call refundEscrow(escrowId)
    },
  }),

  fundEscrow: (params) => ({
    action: async (_ctx) => {
      return { funded: true, escrowId: params["escrowId"], ...params };
    },
    compensation: async (_ctx, result) => {
      const escrowId = (result as Record<string, unknown>)?.["escrowId"];
      logger.info("Compensating: refunding funded escrow", { escrowId });
    },
  }),

  createInvoice: (params) => ({
    action: async (_ctx) => {
      return { invoiceId: params["invoiceId"] ?? `inv-${randomUUID()}`, ...params };
    },
    compensation: async (_ctx, result) => {
      const invoiceId = (result as Record<string, unknown>)?.["invoiceId"];
      logger.info("Compensating: cancelling invoice", { invoiceId });
    },
  }),

  screenAddress: (params) => ({
    action: async (_ctx) => {
      return { screened: true, address: params["address"], ...params };
    },
    compensation: async () => {
      // No-op: screening is informational
    },
  }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRuntimeStep(step: SagaStepRecord): SagaStepRuntime {
  const factory = STEP_REGISTRY[step.type];
  if (!factory) {
    throw new Error(`Unknown saga step type: ${step.type}`);
  }
  const { action, compensation } = factory(step.params);
  return { id: step.id, name: step.name, action, compensation };
}

async function getSagaOrThrow(sagaId: string, apiKeyId?: string): Promise<SagaRecord> {
  const db = getDb();
  const conditions = [eq(sagas.id, sagaId)];
  if (apiKeyId) {
    conditions.push(eq(sagas.apiKeyId, apiKeyId));
  }
  const [row] = await db
    .select()
    .from(sagas)
    .where(and(...conditions))
    .limit(1);

  if (!row) {
    throw new SagaNotFoundError(sagaId);
  }
  return row as unknown as SagaRecord;
}

async function updateSaga(
  sagaId: string,
  updates: Partial<{
    steps: SagaStepRecord[];
    status: SagaStatus;
    currentStep: number;
    error: string | null;
    completedAt: Date | null;
  }>,
): Promise<void> {
  const db = getDb();
  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.status !== undefined) setValues["status"] = updates.status;
  if (updates.currentStep !== undefined) setValues["currentStep"] = updates.currentStep;
  if (updates.error !== undefined) setValues["error"] = updates.error;
  if (updates.completedAt !== undefined) setValues["completedAt"] = updates.completedAt;
  if (updates.steps !== undefined) setValues["steps"] = updates.steps;

  await db
    .update(sagas)
    .set(setValues)
    .where(eq(sagas.id, sagaId));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreateSagaInput {
  name: string;
  steps: Array<{
    name: string;
    type: SagaStepType;
    params: Record<string, unknown>;
  }>;
  traceId?: string;
  apiKeyId?: string;
}

/**
 * Define a multi-step workflow with compensating actions.
 */
export async function createSaga(input: CreateSagaInput): Promise<SagaRecord> {
  const db = getDb();
  const traceId = input.traceId ?? randomUUID();

  const stepRecords: SagaStepRecord[] = input.steps.map((s) => ({
    id: randomUUID(),
    name: s.name,
    type: s.type,
    params: s.params,
    status: "PENDING" as const,
  }));

  const [row] = await db
    .insert(sagas)
    .values({
      name: input.name,
      steps: stepRecords as unknown as Record<string, unknown>[],
      status: "PENDING",
      currentStep: 0,
      traceId,
      apiKeyId: input.apiKeyId ?? null,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to insert saga row.");
  }

  writeAuditLog({
    eventType: "saga.created",
    payload: {
      sagaId: row.id,
      name: input.name,
      stepCount: stepRecords.length,
      traceId,
    },
  });

  logger.info("Saga created", { sagaId: row.id, name: input.name, steps: stepRecords.length });

  return row as unknown as SagaRecord;
}

/**
 * Execute steps sequentially. On failure, run compensating actions in reverse.
 */
export async function executeSaga(sagaId: string, apiKeyId?: string): Promise<SagaRecord> {
  const saga = await getSagaOrThrow(sagaId, apiKeyId);

  if (saga.status !== "PENDING") {
    throw new SagaInvalidStateError(sagaId, saga.status, "PENDING");
  }

  const steps = [...saga.steps];
  const runtimeSteps = steps.map(buildRuntimeStep);

  const context: SagaContext = {
    sagaId,
    traceId: saga.traceId,
    stepResults: {},
    params: {},
  };

  // Mark saga as RUNNING
  await updateSaga(sagaId, { status: "RUNNING" });

  writeAuditLog({
    eventType: "saga.started",
    payload: { sagaId, traceId: saga.traceId },
  });

  let failedAtIndex = -1;

  for (let i = 0; i < runtimeSteps.length; i++) {
    const step = runtimeSteps[i]!;
    const stepRecord = steps[i]!;

    stepRecord.status = "RUNNING";
    stepRecord.startedAt = new Date().toISOString();
    await updateSaga(sagaId, { steps, currentStep: i });

    writeAuditLog({
      eventType: "saga.step.started",
      payload: { sagaId, stepId: step.id, stepName: step.name, stepIndex: i, traceId: saga.traceId },
    });

    try {
      const result = await step.action(context);
      stepRecord.status = "COMPLETED";
      stepRecord.result = result as Record<string, unknown>;
      stepRecord.completedAt = new Date().toISOString();
      context.stepResults[step.id] = result;

      await updateSaga(sagaId, { steps, currentStep: i });

      writeAuditLog({
        eventType: "saga.step.completed",
        payload: { sagaId, stepId: step.id, stepName: step.name, stepIndex: i, traceId: saga.traceId },
      });

      logger.info("Saga step completed", { sagaId, stepId: step.id, stepName: step.name });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stepRecord.status = "FAILED";
      stepRecord.error = message;
      stepRecord.completedAt = new Date().toISOString();

      await updateSaga(sagaId, { steps, currentStep: i, error: message });

      writeAuditLog({
        eventType: "saga.step.failed",
        payload: { sagaId, stepId: step.id, stepName: step.name, stepIndex: i, error: message, traceId: saga.traceId },
      });

      logger.error("Saga step failed", { sagaId, stepId: step.id, stepName: step.name, error: message });
      failedAtIndex = i;
      break;
    }
  }

  // If all steps succeeded
  if (failedAtIndex === -1) {
    await updateSaga(sagaId, { status: "COMPLETED", completedAt: new Date() });
    writeAuditLog({
      eventType: "saga.completed",
      payload: { sagaId, traceId: saga.traceId },
    });
    logger.info("Saga completed successfully", { sagaId });
    return getSagaOrThrow(sagaId);
  }

  // Compensate completed steps in reverse order
  return compensateSteps(sagaId, saga.traceId, steps, runtimeSteps, context, failedAtIndex - 1);
}

/**
 * Run compensating actions for completed steps in reverse order.
 */
async function compensateSteps(
  sagaId: string,
  traceId: string,
  steps: SagaStepRecord[],
  runtimeSteps: SagaStepRuntime[],
  context: SagaContext,
  fromIndex: number,
): Promise<SagaRecord> {
  await updateSaga(sagaId, { status: "COMPENSATING" });

  writeAuditLog({
    eventType: "saga.compensating",
    payload: { sagaId, fromIndex, traceId },
  });

  logger.info("Saga compensating", { sagaId, fromIndex });

  let hasCompensationFailure = false;

  for (let i = fromIndex; i >= 0; i--) {
    const step = runtimeSteps[i]!;
    const stepRecord = steps[i]!;

    if (stepRecord.status !== "COMPLETED") {
      continue;
    }

    stepRecord.status = "COMPENSATING";
    await updateSaga(sagaId, { steps, currentStep: i });

    writeAuditLog({
      eventType: "saga.step.compensating",
      payload: { sagaId, stepId: step.id, stepName: step.name, stepIndex: i, traceId },
    });

    try {
      await step.compensation(context, stepRecord.result);
      stepRecord.status = "COMPENSATED";
      stepRecord.completedAt = new Date().toISOString();

      await updateSaga(sagaId, { steps, currentStep: i });

      writeAuditLog({
        eventType: "saga.step.compensated",
        payload: { sagaId, stepId: step.id, stepName: step.name, stepIndex: i, traceId },
      });

      logger.info("Saga step compensated", { sagaId, stepId: step.id, stepName: step.name });
    } catch (err: unknown) {
      // Log compensation failure but continue compensating remaining steps
      const message = err instanceof Error ? err.message : String(err);
      stepRecord.status = "COMPENSATION_FAILED";
      stepRecord.compensationError = message;
      hasCompensationFailure = true;

      await updateSaga(sagaId, { steps, currentStep: i });

      writeAuditLog({
        eventType: "saga.step.compensation_failed",
        payload: { sagaId, stepId: step.id, stepName: step.name, stepIndex: i, error: message, traceId },
      });

      logger.error("Saga step compensation failed", { sagaId, stepId: step.id, error: message });
    }
  }

  const finalStatus: SagaStatus = hasCompensationFailure ? "FAILED" : "COMPENSATED";
  await updateSaga(sagaId, {
    status: finalStatus,
    completedAt: new Date(),
    error: hasCompensationFailure ? "One or more compensation steps failed" : steps.find((s) => s.error)?.error ?? null,
  });

  writeAuditLog({
    eventType: `saga.${finalStatus.toLowerCase()}`,
    payload: { sagaId, traceId, hasCompensationFailure },
  });

  logger.info("Saga compensation finished", { sagaId, finalStatus });

  return getSagaOrThrow(sagaId);
}

/**
 * Get current execution state of a saga.
 */
export async function getSagaStatus(sagaId: string, apiKeyId?: string): Promise<SagaRecord> {
  return getSagaOrThrow(sagaId, apiKeyId);
}

/**
 * Cancel a saga — trigger compensation for all completed steps.
 */
export async function cancelSaga(sagaId: string, apiKeyId?: string): Promise<SagaRecord> {
  const saga = await getSagaOrThrow(sagaId, apiKeyId);

  if (saga.status === "COMPENSATING" || saga.status === "COMPENSATED" || saga.status === "FAILED") {
    throw new SagaInvalidStateError(sagaId, saga.status, "PENDING | RUNNING | COMPLETED");
  }

  const steps = [...saga.steps];
  const runtimeSteps = steps.map(buildRuntimeStep);

  const context: SagaContext = {
    sagaId,
    traceId: saga.traceId,
    stepResults: {},
    params: {},
  };

  // Rebuild step results from stored data
  for (const step of steps) {
    if (step.result !== undefined) {
      context.stepResults[step.id] = step.result;
    }
  }

  writeAuditLog({
    eventType: "saga.cancel_requested",
    payload: { sagaId, traceId: saga.traceId, previousStatus: saga.status },
  });

  // Find the last completed step
  let lastCompletedIndex = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i]!.status === "COMPLETED") {
      lastCompletedIndex = i;
      break;
    }
  }

  if (lastCompletedIndex === -1) {
    // Nothing to compensate
    await updateSaga(sagaId, { status: "COMPENSATED", completedAt: new Date() });
    return getSagaOrThrow(sagaId);
  }

  return compensateSteps(sagaId, saga.traceId, steps, runtimeSteps, context, lastCompletedIndex);
}
