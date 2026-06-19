import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { agents } from "../db/schema.js";
import type { AuthContext } from "../middleware/auth.js";
import { requireScope } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { issueKYACredential, verifyCredentialSignature } from "../services/kya-issuer.js";
import { KYACredentialSubjectSchema, KYAVerifiableCredentialSchema } from "../services/kya-schema.js";
import {
  createSelectiveProof,
  verifySelectiveProof,
} from "../services/selective-disclosure.js";
import { writeAuditLog } from "../utils/audit.js";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const VerifyAgentRequest = z.object({
  agentId: z.string().min(1),
  registryAddress: z.string().optional(),
  chain: z.string().default("eip155:8453"),
});
type VerifyAgentRequest = z.infer<typeof VerifyAgentRequest>;

const IssueKYARequest = z.object({
  agentDid: z.string().min(1).regex(/^did:[a-z]+:/, "agentDid must be a valid DID (did:method:...)"),
  agentType: z.enum(["autonomous", "semi-autonomous", "human-supervised"]),
  controllingEntity: z.object({
    name: z.string().min(1),
    lei: z.string().optional(),
    did: z.string().optional(),
    kybVerified: z.boolean(),
  }),
  walletAddress: z.string().min(1),
  delegationScope: z.object({
    maxTransactionValue: z.number().nonnegative(),
    dailyLimit: z.number().nonnegative().optional(),
    allowedCounterparties: z.array(z.string()).optional(),
    blockedJurisdictions: z.array(z.string()).optional(),
    allowedChains: z.array(z.string()).optional(),
    allowedCurrencies: z.array(z.string()).optional(),
    expiresAt: z.string().datetime(),
  }),
  erc8004RegistryAddress: z.string().optional(),
  erc8004TokenId: z.string().optional(),
});
type IssueKYARequest = z.infer<typeof IssueKYARequest>;

const AgentIdParams = z.object({
  agentId: z.string().min(1, "agentId is required"),
});

const AgentUuidParams = z.object({
  id: z.string().uuid("Invalid agent ID format."),
});

const RegisterAgentRequest = z.object({
  agentDid: z.string().min(1).regex(/^did:[a-z]+:/, "agentDid must be a valid DID (did:method:...)"),
  name: z.string().min(1),
  agentType: z.enum(["autonomous", "semi-autonomous", "human-supervised"]),
  walletAddress: z.string().min(1),
  controllingEntity: z.object({
    name: z.string().min(1),
    lei: z.string().optional(),
  }),
  delegationScope: z.object({
    maxTransactionValue: z.number().nonnegative(),
    dailyLimit: z.number().nonnegative().optional(),
    allowedCounterparties: z.array(z.string()).optional(),
    blockedJurisdictions: z.array(z.string()).optional(),
    allowedChains: z.array(z.string()).optional(),
    allowedCurrencies: z.array(z.string()).optional(),
    expiresAt: z.string().datetime(),
  }),
});
type RegisterAgentRequest = z.infer<typeof RegisterAgentRequest>;

const UpdateDelegationRequest = z.object({
  maxTransactionValue: z.number().nonnegative().optional(),
  dailyLimit: z.number().nonnegative().optional(),
  allowedCounterparties: z.array(z.string()).optional(),
  blockedJurisdictions: z.array(z.string()).optional(),
  allowedChains: z.array(z.string()).optional(),
  allowedCurrencies: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});
type UpdateDelegationRequest = z.infer<typeof UpdateDelegationRequest>;

const ListAgentsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  agentType: z.enum(["autonomous", "semi-autonomous", "human-supervised"]).optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

// ---------------------------------------------------------------------------
// Route group
// ---------------------------------------------------------------------------

const identity = new Hono();

// POST /v1/identity/verify -- Verify agent KYA
identity.post("/verify", requireScope("write"), validate({ body: VerifyAgentRequest }), async (c) => {
  const parsed = c.get("validatedBody") as VerifyAgentRequest;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  // Look up agent by agentDid (using agentId as DID identifier), scoped by tenant
  const conditions = [eq(agents.agentDid, parsed.agentId)];
  if (auth?.apiKeyId) {
    conditions.push(eq(agents.apiKeyId, auth.apiKeyId));
  }
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(...conditions))
    .limit(1);

  if (!agent) {
    return c.json(
      {
        success: true,
        data: {
          verified: false,
          trustScore: 0,
          agentMetadata: null,
          message: `Agent ${parsed.agentId} not found in registry.`,
        },
      },
      200,
    );
  }

  const isValid = agent.isActive && (!agent.expiresAt || agent.expiresAt > new Date());

  return c.json(
    {
      success: true,
      data: {
        verified: isValid,
        trustScore: isValid ? agent.complianceScore : 0,
        agentMetadata: {
          name: agent.name,
          type: agent.agentType,
          operator: agent.controllingEntityName,
          registeredAt: agent.createdAt.toISOString(),
          walletAddress: agent.walletAddress,
        },
        operatorStatus: {
          sanctionsCleared: isValid,
          kycVerified: true,
        },
        delegationScope: agent.delegationScope,
      },
    },
    200,
  );
});

// GET /v1/identity/agents -- List all agents (paginated)
// NOTE: Must be registered BEFORE /:agentId to avoid being shadowed by the wildcard.
identity.get("/agents", validate({ query: ListAgentsQuery }), async (c) => {
  const query = c.get("validatedQuery") as z.infer<typeof ListAgentsQuery>;
  const { page, limit, agentType, isActive } = query;
  const offset = (page - 1) * limit;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  const conditions = [];
  if (auth?.apiKeyId) {
    conditions.push(eq(agents.apiKeyId, auth.apiKeyId));
  }
  if (agentType) {
    conditions.push(eq(agents.agentType, agentType));
  }
  if (isActive !== undefined) {
    conditions.push(eq(agents.isActive, isActive === "true"));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(agents)
      .where(whereClause)
      .orderBy(desc(agents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agents)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  return c.json(
    {
      success: true,
      data: {
        items: items.map((agent) => ({
          id: agent.id,
          agentDid: agent.agentDid,
          name: agent.name,
          agentType: agent.agentType,
          walletAddress: agent.walletAddress,
          controllingEntity: {
            name: agent.controllingEntityName,
            lei: agent.controllingEntityLei,
          },
          complianceScore: agent.complianceScore,
          isActive: agent.isActive,
          delegationScope: agent.delegationScope,
          createdAt: agent.createdAt.toISOString(),
          updatedAt: agent.updatedAt.toISOString(),
        })),
        pagination: {
          page,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    },
    200,
  );
});

// GET /v1/identity/:agentId -- Get agent identity info
// NOTE: Must be registered AFTER all static GET routes (e.g., /agents) to avoid shadowing them.
identity.get("/:agentId", validate({ params: AgentIdParams }), async (c) => {
  const { agentId } = c.get("validatedParams") as z.infer<typeof AgentIdParams>;
  const auth = c.get("auth") as AuthContext | undefined;
  const db = getDb();

  const conditions = [eq(agents.agentDid, agentId)];
  if (auth?.apiKeyId) {
    conditions.push(eq(agents.apiKeyId, auth.apiKeyId));
  }
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(...conditions))
    .limit(1);

  if (!agent) {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: "Agent not found." } },
      404,
    );
  }

  return c.json(
    {
      success: true,
      data: {
        id: agent.id,
        agentDid: agent.agentDid,
        name: agent.name,
        agentType: agent.agentType,
        walletAddress: agent.walletAddress,
        controllingEntity: {
          name: agent.controllingEntityName,
          lei: agent.controllingEntityLei,
        },
        erc8004Id: agent.erc8004Id,
        erc8004Registry: agent.erc8004Registry,
        complianceScore: agent.complianceScore,
        isActive: agent.isActive,
        delegationScope: agent.delegationScope,
        validatedAt: agent.validatedAt?.toISOString() ?? null,
        expiresAt: agent.expiresAt?.toISOString() ?? null,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
      },
    },
    200,
  );
});

// POST /v1/identity/kya/issue -- Issue KYA credential
identity.post("/kya/issue", requireScope("write"), validate({ body: IssueKYARequest }), async (c) => {
  const parsed = c.get("validatedBody") as IssueKYARequest;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();

  // Upsert agent record
  const now = new Date();
  const expiresAt = new Date(parsed.delegationScope.expiresAt);
  const defaultComplianceScore = 80;

  // Look up existing agent to preserve compliance score on re-issue
  const existingConditions = [eq(agents.agentDid, parsed.agentDid)];
  if (auth?.apiKeyId) {
    existingConditions.push(eq(agents.apiKeyId, auth.apiKeyId));
  }
  const [existingAgent] = await db
    .select({ complianceScore: agents.complianceScore })
    .from(agents)
    .where(and(...existingConditions))
    .limit(1);

  const [agent] = await db
    .insert(agents)
    .values({
      agentDid: parsed.agentDid,
      agentType: parsed.agentType,
      walletAddress: parsed.walletAddress,
      controllingEntityName: parsed.controllingEntity.name,
      controllingEntityLei: parsed.controllingEntity.lei,
      erc8004Registry: parsed.erc8004RegistryAddress,
      erc8004Id: parsed.erc8004TokenId ? Number(parsed.erc8004TokenId) : null,
      complianceScore: defaultComplianceScore,
      delegationScope: parsed.delegationScope,
      isActive: true,
      validatedAt: now,
      expiresAt,
      apiKeyId: auth?.apiKeyId,
    })
    .onConflictDoUpdate({
      target: agents.agentDid,
      set: {
        agentType: parsed.agentType,
        walletAddress: parsed.walletAddress,
        controllingEntityName: parsed.controllingEntity.name,
        controllingEntityLei: parsed.controllingEntity.lei,
        delegationScope: parsed.delegationScope,
        complianceScore: existingAgent?.complianceScore ?? defaultComplianceScore,
        isActive: true,
        validatedAt: now,
        expiresAt,
        updatedAt: now,
      },
    })
    .returning();

  if (!agent) {
    return c.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Failed to issue KYA credential." } },
      500,
    );
  }

  // Build W3C VC-shaped response (placeholder proof -- real impl signs with issuer key)
  const credential = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://prooflink.io/credentials/kya/v1",
    ],
    type: ["VerifiableCredential", "KYACredential"],
    id: `urn:uuid:${agent.id}`,
    issuer: {
      id: "did:prooflink:issuer",
      name: "ProofLink",
    },
    issuanceDate: now.toISOString(),
    expirationDate: expiresAt.toISOString(),
    credentialSubject: {
      id: parsed.agentDid,
      agentType: parsed.agentType,
      controllingEntity: parsed.controllingEntity,
      delegationScope: parsed.delegationScope,
      walletAddress: parsed.walletAddress,
      erc8004RegistryAddress: parsed.erc8004RegistryAddress ?? null,
      erc8004TokenId: parsed.erc8004TokenId ?? null,
    },
    proof: {
      type: "EcdsaSecp256k1Signature2019",
      created: now.toISOString(),
      verificationMethod: "did:prooflink:issuer#key-1",
      proofPurpose: "assertionMethod",
      jws: "placeholder-signature",
    },
  };

  writeAuditLog({
    eventType: "kya.credential.issued",
    agentDid: agent.agentDid,
    payload: {
      agentId: agent.id,
      agentDid: agent.agentDid,
      agentType: agent.agentType,
      walletAddress: agent.walletAddress,
    },
  });

  return c.json({
    success: true,
    data: {
      agent: {
        id: agent.id,
        agentDid: agent.agentDid,
        name: agent.name,
        agentType: agent.agentType,
        walletAddress: agent.walletAddress,
        controllingEntityName: agent.controllingEntityName,
        controllingEntityLei: agent.controllingEntityLei,
        complianceScore: agent.complianceScore,
        isActive: agent.isActive,
        delegationScope: agent.delegationScope,
        validatedAt: agent.validatedAt?.toISOString() ?? null,
        expiresAt: agent.expiresAt?.toISOString() ?? null,
        createdAt: agent.createdAt.toISOString(),
      },
      credential,
    },
  }, 201);
});

// POST /v1/identity/agents -- Register a new agent
identity.post("/agents", requireScope("write"), validate({ body: RegisterAgentRequest }), async (c) => {
  const parsed = c.get("validatedBody") as RegisterAgentRequest;
  const auth = c.get("auth") as AuthContext | undefined;

  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(parsed.delegationScope.expiresAt);

  const existingConditions = [eq(agents.agentDid, parsed.agentDid)];
  if (auth?.apiKeyId) {
    existingConditions.push(eq(agents.apiKeyId, auth.apiKeyId));
  }
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(...existingConditions))
    .limit(1);

  if (existing) {
    return c.json(
      {
        success: false,
        error: {
          code: "CONFLICT",
          message: `Agent with DID ${parsed.agentDid} already exists.`,
        },
      },
      409,
    );
  }

  const [agent] = await db
    .insert(agents)
    .values({
      agentDid: parsed.agentDid,
      name: parsed.name,
      agentType: parsed.agentType,
      walletAddress: parsed.walletAddress,
      controllingEntityName: parsed.controllingEntity.name,
      controllingEntityLei: parsed.controllingEntity.lei,
      complianceScore: 80,
      delegationScope: parsed.delegationScope,
      isActive: true,
      validatedAt: now,
      expiresAt,
      apiKeyId: auth?.apiKeyId,
    })
    .returning();

  if (!agent) {
    return c.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Failed to register agent." } },
      500,
    );
  }

  writeAuditLog({
    eventType: "agent.registered",
    agentDid: agent.agentDid,
    payload: {
      agentId: agent.id,
      agentDid: agent.agentDid,
      name: agent.name,
      agentType: agent.agentType,
      walletAddress: agent.walletAddress,
    },
  });

  return c.json(
    {
      success: true,
      data: {
        id: agent.id,
        agentDid: agent.agentDid,
        name: agent.name,
        agentType: agent.agentType,
        walletAddress: agent.walletAddress,
        controllingEntity: {
          name: agent.controllingEntityName,
          lei: agent.controllingEntityLei,
        },
        complianceScore: agent.complianceScore,
        isActive: agent.isActive,
        delegationScope: agent.delegationScope,
        validatedAt: agent.validatedAt?.toISOString() ?? null,
        expiresAt: agent.expiresAt?.toISOString() ?? null,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
      },
    },
    201,
  );
});

// PUT /v1/identity/agents/:id/delegation -- Update delegation scope
identity.put(
  "/agents/:id/delegation",
  requireScope("write"),
  validate({ params: AgentUuidParams, body: UpdateDelegationRequest }),
  async (c) => {
    const { id } = c.get("validatedParams") as z.infer<typeof AgentUuidParams>;
    const updates = c.get("validatedBody") as UpdateDelegationRequest;
    const auth = c.get("auth") as AuthContext | undefined;

    const db = getDb();

    const conditions = [eq(agents.id, id)];
    if (auth?.apiKeyId) {
      conditions.push(eq(agents.apiKeyId, auth.apiKeyId));
    }
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(...conditions))
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Agent not found." } },
        404,
      );
    }

    const currentScope = (existing.delegationScope ?? {}) as Record<string, unknown>;
    const newScope: Record<string, unknown> = { ...currentScope };

    if (updates.maxTransactionValue !== undefined) newScope["maxTransactionValue"] = updates.maxTransactionValue;
    if (updates.dailyLimit !== undefined) newScope["dailyLimit"] = updates.dailyLimit;
    if (updates.allowedCounterparties !== undefined) newScope["allowedCounterparties"] = updates.allowedCounterparties;
    if (updates.blockedJurisdictions !== undefined) newScope["blockedJurisdictions"] = updates.blockedJurisdictions;
    if (updates.allowedChains !== undefined) newScope["allowedChains"] = updates.allowedChains;
    if (updates.allowedCurrencies !== undefined) newScope["allowedCurrencies"] = updates.allowedCurrencies;
    if (updates.expiresAt !== undefined) newScope["expiresAt"] = updates.expiresAt;

    const [updated] = await db
      .update(agents)
      .set({
        delegationScope: newScope,
        expiresAt: updates.expiresAt ? new Date(updates.expiresAt) : existing.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, id))
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "INTERNAL_ERROR", message: "Failed to update delegation scope." } },
        500,
      );
    }

    writeAuditLog({
      eventType: "agent.delegation.updated",
      agentDid: updated.agentDid,
      payload: {
        agentId: updated.id,
        agentDid: updated.agentDid,
        previousScope: currentScope,
        newScope,
      },
    });

    return c.json(
      {
        success: true,
        data: {
          id: updated.id,
          agentDid: updated.agentDid,
          name: updated.name,
          delegationScope: updated.delegationScope,
          expiresAt: updated.expiresAt?.toISOString() ?? null,
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
      200,
    );
  },
);

// ---------------------------------------------------------------------------
// POST /v1/identity/credentials/issue -- Issue a signed KYA credential
// ---------------------------------------------------------------------------

const IssueCredentialRequest = z.object({
  agentDid: z
    .string()
    .min(1)
    .regex(/^did:[a-z]+:/, "agentDid must be a valid DID (did:method:...)"),
  controllingEntityName: z.string().min(1),
  controllingEntityLEI: z
    .string()
    .regex(/^[A-Z0-9]{20}$/, "LEI must be exactly 20 alphanumeric characters (ISO 17442)")
    .optional(),
  walletAddress: z.string().min(1),
  delegationScope: z.object({
    maxTransactionValue: z.number().nonnegative(),
    dailyLimit: z.number().nonnegative().optional(),
    allowedCounterparties: z.array(z.string()).optional(),
    blockedJurisdictions: z.array(z.string()).optional(),
    allowedChains: z.array(z.string()).optional(),
    allowedCurrencies: z.array(z.string()).optional(),
    expiresAt: z.string().datetime(),
  }),
  expiresAt: z.string().datetime(),
  agentType: z.enum(["autonomous", "semi-autonomous", "human-supervised"]).optional(),
  erc8004AgentId: z.string().optional(),
  allowedProtocols: z.array(z.string()).optional(),
});
type IssueCredentialRequest = z.infer<typeof IssueCredentialRequest>;

identity.post(
  "/credentials/issue",
  requireScope("write"),
  validate({ body: IssueCredentialRequest }),
  async (c) => {
    const parsed = c.get("validatedBody") as IssueCredentialRequest;
    const auth = c.get("auth") as AuthContext | undefined;

    let issued;
    try {
      issued = issueKYACredential({
        agentDid: parsed.agentDid,
        controllingEntityName: parsed.controllingEntityName,
        controllingEntityLEI: parsed.controllingEntityLEI,
        walletAddress: parsed.walletAddress,
        delegationScope: parsed.delegationScope,
        expiresAt: parsed.expiresAt,
        agentType: parsed.agentType,
        erc8004AgentId: parsed.erc8004AgentId,
        allowedProtocols: parsed.allowedProtocols,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        { success: false, error: { code: "ISSUANCE_FAILED", message } },
        500,
      );
    }

    // Persist credential hash to the agent record (upsert)
    const db = getDb();
    const now = new Date();
    const expiresAt = new Date(parsed.expiresAt);

    await db
      .insert(agents)
      .values({
        agentDid: parsed.agentDid,
        agentType: parsed.agentType ?? "autonomous",
        walletAddress: parsed.walletAddress,
        controllingEntityName: parsed.controllingEntityName,
        controllingEntityLei: parsed.controllingEntityLEI,
        kyaCredentialHash: issued.credentialHash,
        complianceScore: 80,
        delegationScope: parsed.delegationScope,
        isActive: true,
        validatedAt: now,
        expiresAt,
        apiKeyId: auth?.apiKeyId,
      })
      .onConflictDoUpdate({
        target: agents.agentDid,
        set: {
          walletAddress: parsed.walletAddress,
          controllingEntityName: parsed.controllingEntityName,
          controllingEntityLei: parsed.controllingEntityLEI,
          kyaCredentialHash: issued.credentialHash,
          delegationScope: parsed.delegationScope,
          isActive: true,
          validatedAt: now,
          expiresAt,
          updatedAt: now,
        },
      });

    return c.json(
      {
        success: true,
        data: {
          credential: issued.credential,
          credentialHash: issued.credentialHash,
          leiWarning: parsed.controllingEntityLEI
            ? undefined
            : "controllingEntityLEI is strongly recommended for production use (ISO 17442)",
        },
      },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// POST /v1/identity/credentials/verify -- Verify a KYA credential
// ---------------------------------------------------------------------------

const VerifyCredentialRequest = z.object({
  credential: KYAVerifiableCredentialSchema,
  transactionAmountUsd: z.number().nonnegative().optional(),
  jurisdiction: z.string().optional(),
});
type VerifyCredentialRequest = z.infer<typeof VerifyCredentialRequest>;

identity.post(
  "/credentials/verify",
  requireScope("write"),
  validate({ body: VerifyCredentialRequest }),
  async (c) => {
    const parsed = c.get("validatedBody") as VerifyCredentialRequest;
    const { credential } = parsed;
    const errors: string[] = [];

    // 1. Verify HMAC signature
    let signatureValid = false;
    try {
      signatureValid = verifyCredentialSignature(credential);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Signature verification failed: ${message}`);
    }

    if (!signatureValid && errors.length === 0) {
      errors.push("Credential signature is invalid");
    }

    // 2. Check expiration
    const now = new Date();
    const credentialExpired = new Date(credential.expirationDate) < now;
    if (credentialExpired) {
      errors.push(`Credential expired at ${credential.expirationDate}`);
    }

    // 3. Check delegation scope expiry
    const delegationExpired =
      new Date(credential.credentialSubject.delegationScope.expiresAt) < now;
    if (delegationExpired) {
      errors.push(
        `Delegation expired at ${credential.credentialSubject.delegationScope.expiresAt}`,
      );
    }

    // 4. Check transaction amount against delegation limit
    if (
      parsed.transactionAmountUsd !== undefined &&
      parsed.transactionAmountUsd >
        credential.credentialSubject.delegationScope.maxTransactionValue
    ) {
      errors.push(
        `Transaction amount $${parsed.transactionAmountUsd} exceeds delegation limit $${credential.credentialSubject.delegationScope.maxTransactionValue}`,
      );
    }

    // 5. Check jurisdiction against blocked list
    if (
      parsed.jurisdiction &&
      credential.credentialSubject.delegationScope.blockedJurisdictions?.includes(
        parsed.jurisdiction,
      )
    ) {
      errors.push(
        `Jurisdiction ${parsed.jurisdiction} is blocked by delegation scope`,
      );
    }

    // 6. Verify credential hash matches the stored hash (if agent exists)
    let storedHashMatch: boolean | null = null;
    const db = getDb();
    const [agent] = await db
      .select({ kyaCredentialHash: agents.kyaCredentialHash })
      .from(agents)
      .where(eq(agents.agentDid, credential.credentialSubject.id))
      .limit(1);

    if (agent?.kyaCredentialHash) {
      storedHashMatch = agent.kyaCredentialHash === credential.credentialHash;
      if (!storedHashMatch) {
        errors.push("Credential hash does not match the stored credential for this agent");
      }
    }

    const verified = errors.length === 0 && signatureValid;

    return c.json({
      success: true,
      data: {
        verified,
        signatureValid,
        credentialExpired,
        delegationExpired,
        storedHashMatch,
        agentDid: credential.credentialSubject.id,
        controllingEntity: credential.credentialSubject.controllingEntityName,
        errors,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /v1/identity/agents/:did/credential -- Get latest credential for agent
// ---------------------------------------------------------------------------

const AgentDidParams = z.object({
  did: z.string().min(1, "DID is required"),
});

identity.get(
  "/agents/:did/credential",
  validate({ params: AgentDidParams }),
  async (c) => {
    const { did } = c.get("validatedParams") as z.infer<typeof AgentDidParams>;
    const auth = c.get("auth") as AuthContext | undefined;

    // DID may be URL-encoded (colons replaced with %3A)
    const decodedDid = decodeURIComponent(did);

    const db = getDb();
    const credConditions = [eq(agents.agentDid, decodedDid)];
    if (auth?.apiKeyId) {
      credConditions.push(eq(agents.apiKeyId, auth.apiKeyId));
    }
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(...credConditions))
      .limit(1);

    if (!agent) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Agent not found." } },
        404,
      );
    }

    if (!agent.kyaCredentialHash) {
      return c.json(
        {
          success: false,
          error: {
            code: "NO_CREDENTIAL",
            message: "No KYA credential has been issued for this agent. Use POST /v1/identity/credentials/issue first.",
          },
        },
        404,
      );
    }

    return c.json({
      success: true,
      data: {
        agentDid: agent.agentDid,
        credentialHash: agent.kyaCredentialHash,
        controllingEntity: {
          name: agent.controllingEntityName,
          lei: agent.controllingEntityLei,
        },
        walletAddress: agent.walletAddress,
        agentType: agent.agentType,
        delegationScope: agent.delegationScope,
        isActive: agent.isActive,
        validatedAt: agent.validatedAt?.toISOString() ?? null,
        expiresAt: agent.expiresAt?.toISOString() ?? null,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// POST /v1/identity/credentials/selective-verify -- Verify with selective disclosure
// ---------------------------------------------------------------------------

const SelectiveVerifyRequest = z.object({
  credential: KYAVerifiableCredentialSchema,
  disclosedFields: z.array(z.string()).min(1, "At least one field must be disclosed"),
  transactionAmountUsd: z.number().nonnegative().optional(),
  jurisdiction: z.string().optional(),
});
type SelectiveVerifyRequest = z.infer<typeof SelectiveVerifyRequest>;

identity.post(
  "/credentials/selective-verify",
  requireScope("write"),
  validate({ body: SelectiveVerifyRequest }),
  async (c) => {
    const parsed = c.get("validatedBody") as SelectiveVerifyRequest;
    const { credential, disclosedFields } = parsed;
    const errors: string[] = [];

    // 1. Verify HMAC signature (full credential needed for this)
    let signatureValid = false;
    try {
      signatureValid = verifyCredentialSignature(credential);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Signature verification failed: ${message}`);
    }

    if (!signatureValid && errors.length === 0) {
      errors.push("Credential signature is invalid");
    }

    // 2. Check expiration
    const now = new Date();
    const credentialExpired = new Date(credential.expirationDate) < now;
    if (credentialExpired) {
      errors.push(`Credential expired at ${credential.expirationDate}`);
    }

    // 3. Check delegation scope expiry
    const delegationExpired =
      new Date(credential.credentialSubject.delegationScope.expiresAt) < now;
    if (delegationExpired) {
      errors.push(
        `Delegation expired at ${credential.credentialSubject.delegationScope.expiresAt}`,
      );
    }

    // 4. Check transaction amount if provided
    if (
      parsed.transactionAmountUsd !== undefined &&
      parsed.transactionAmountUsd >
        credential.credentialSubject.delegationScope.maxTransactionValue
    ) {
      errors.push(
        `Transaction amount $${parsed.transactionAmountUsd} exceeds delegation limit $${credential.credentialSubject.delegationScope.maxTransactionValue}`,
      );
    }

    // 5. Check jurisdiction
    if (
      parsed.jurisdiction &&
      credential.credentialSubject.delegationScope.blockedJurisdictions?.includes(
        parsed.jurisdiction,
      )
    ) {
      errors.push(
        `Jurisdiction ${parsed.jurisdiction} is blocked by delegation scope`,
      );
    }

    // 6. Create selective disclosure proof — only requested fields are revealed
    const credentialData = credential.credentialSubject as unknown as Record<string, unknown>;
    const selectiveProof = createSelectiveProof(credentialData, disclosedFields);

    // 7. Verify the selective proof is internally consistent
    const proofVerification = verifySelectiveProof(selectiveProof, disclosedFields);
    if (!proofVerification.valid) {
      errors.push(...proofVerification.errors);
    }

    const verified = errors.length === 0 && signatureValid;

    return c.json({
      success: true,
      data: {
        verified,
        signatureValid,
        credentialExpired,
        delegationExpired,
        // Only disclosed fields are visible — everything else is hashed
        disclosedFields: selectiveProof.disclosed,
        undisclosedFieldHashes: selectiveProof.undisclosedHashes,
        proofHash: selectiveProof.proofHash,
        nonce: selectiveProof.nonce,
        errors,
      },
    });
  },
);

export { identity };
