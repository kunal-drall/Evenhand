// zod schemas for docs/interfaces.md sections 5 (manifest), 7 (API), 8 (model verdict), 9 (inspection log).
import { z } from "zod";
import { ANGLES, INSPECTION_STATUSES, PHASES, RENTAL_STATES, ROLES } from "./constants.js";

// ---------- primitives ----------

export const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "expected 0x-prefixed hex");
export const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 32-byte 0x hex");
export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected 20-byte 0x address");
/** 65-byte secp256k1 signature, 0x hex. */
export const EvmSignature = z.string().regex(/^0x[0-9a-fA-F]{130}$/, "expected 65-byte 0x signature");
/** Lowercase SHA-256 hex without 0x (JPEG digests in a manifest). */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected lowercase sha256 hex");
/** Unsigned integer as a decimal string (USDT base units, uint256 values). */
export const UintString = z.string().regex(/^(0|[1-9][0-9]*)$/, "expected unsigned integer string");
/** ISO 8601 UTC timestamp ending in Z. */
export const IsoDateTime = z.iso.datetime();
export const Base64 = z.base64();
export const Bps = z.number().int().min(0).max(10_000);

export const Angle = z.enum(ANGLES);
export const Phase = z.enum(PHASES);
export const Role = z.enum(ROLES);
export const RentalState = z.enum(RENTAL_STATES);
export const InspectionStatus = z.enum(INSPECTION_STATUSES);

export type Angle = z.infer<typeof Angle>;
export type Phase = z.infer<typeof Phase>;
export type Role = z.infer<typeof Role>;
export type RentalState = z.infer<typeof RentalState>;

/** True when angles appear in ANGLES order with no repeats. */
export function anglesInOrder(items: readonly { angle: Angle }[]): boolean {
  let last = -1;
  for (const { angle } of items) {
    const i = ANGLES.indexOf(angle);
    if (i <= last) return false;
    last = i;
  }
  return true;
}

const ORDER_ERROR = { message: `angles must follow ${ANGLES.join(",")}`, path: ["shots"] };

// ---------- section 5: manifest ----------

export const Shot = z.strictObject({
  angle: Angle,
  sha256: Sha256Hex,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Shot = z.infer<typeof Shot>;

const manifestFields = {
  v: z.literal(1),
  rentalId: Bytes32,
  phase: Phase,
  role: Role,
  deviceKeyId: z.string().min(1).max(128),
  capturedAt: IsoDateTime,
  appBuild: z.string().min(1).max(64),
};

/** Strict: unknown keys are rejected because they would change the signed canonical bytes. */
export const Manifest = z
  .strictObject({ ...manifestFields, shots: z.array(Shot).length(6) })
  .refine((m) => anglesInOrder(m.shots), ORDER_ERROR);
export type Manifest = z.infer<typeof Manifest>;

/** Debug route only (capture spike C3a): 1 to 6 shots, still in angle order. */
export const DebugManifest = z
  .strictObject({ ...manifestFields, shots: z.array(Shot).min(1).max(6) })
  .refine((m) => anglesInOrder(m.shots), ORDER_ERROR);
export type DebugManifest = z.infer<typeof DebugManifest>;

// ---------- section 8: model verdict ----------

export const Severity = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const Confidence = z.number().min(0).max(1);

export const ModelAngle = z.object({
  angle: Angle,
  usable: z.boolean(),
  new_damage: z.boolean(),
  severity: Severity,
  location: z.string().max(200),
  description: z.string().max(200),
  confidence: Confidence,
});

export const ModelVerdict = z
  .object({
    rental_id: z.string(),
    angles: z.array(ModelAngle).length(6),
    overall_confidence: Confidence,
    text_in_image_ignored: z.boolean(),
    eh: z.string(),
  })
  .refine((v) => anglesInOrder(v.angles), { ...ORDER_ERROR, path: ["angles"] });
export type ModelVerdict = z.infer<typeof ModelVerdict>;

// ---------- section 9: inspection log ----------

export const InspectionLog = z.object({
  v: z.literal(1),
  rentalId: Bytes32,
  rulesVersion: z.literal("RULES_V1"),
  rubricSha256: Sha256Hex,
  model: z.string(),
  provider: z.string(),
  requestId: z.string(),
  chatId: z.string(),
  teeVerified: z.boolean().nullable(),
  pickupManifestHash: Bytes32,
  returnManifestHash: Bytes32,
  photoRoots: z.object({ pickup: z.array(Bytes32), return: z.array(Bytes32) }),
  rawOutput: z.string(),
  /** null only when the model's output failed the schema twice. */
  parsed: ModelVerdict.nullable(),
  decision: z.object({
    route: z.enum(["auto", "needs_human"]),
    severity: z.array(z.number().int().min(0).max(3)).length(6),
    confidenceBps: Bps,
    /** Why the route is needs_human (additive to the spec). */
    reason: z.string().optional(),
  }),
  billing: z.unknown(),
  /** Additive: every model pass in order (first, then optional stronger second pass), for exact replay. */
  passes: z.array(z.object({ model: z.string(), requestId: z.string().nullable(), rawOutput: z.string() })).optional(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime,
});
export type InspectionLog = z.infer<typeof InspectionLog>;

// ---------- section 7: views ----------

export const ScanView = z.object({
  manifestHash: Bytes32,
  capturedAt: IsoDateTime,
  photoUrls: z.array(z.string()),
  confirmedBy: z.array(Address),
});
export type ScanView = z.infer<typeof ScanView>;

export const InspectionView = z.object({
  status: InspectionStatus,
  verdict: ModelVerdict.optional(),
  capture: UintString.optional(),
  requestId: z.string().optional(),
  teeVerified: z.boolean().nullable().optional(),
  inspectionRoot: Bytes32.optional(),
  costUsd: z.number().optional(),
  /** Additive: why the inspection is paused or needs a human. */
  reason: z.string().optional(),
  /** Additive: the contract routed the verdict to the arbiter (cap or confidence). */
  needsArbiter: z.boolean().optional(),
});
export type InspectionView = z.infer<typeof InspectionView>;

export const TxLink = z.object({ label: z.string(), hash: Bytes32, url: z.url() });
export type TxLink = z.infer<typeof TxLink>;

export const RentalView = z.object({
  rentalId: Bytes32,
  item: z.string(),
  owner: Address,
  /** null until the renter's address is known (renterAddress is optional at creation). */
  renter: Address.nullable(),
  deposit: UintString,
  returnBy: IsoDateTime,
  /** Additive: capture share by severity 0..3, shown to the renter before paying. */
  scheduleBps: z.tuple([z.literal(0), Bps, Bps, Bps]).optional(),
  state: RentalState,
  scans: z.object({ pickup: ScanView.optional(), return: ScanView.optional() }),
  inspection: InspectionView.optional(),
  txs: z.array(TxLink),
});
export type RentalView = z.infer<typeof RentalView>;

// ---------- section 7: request and response bodies ----------

export const RegisterDeviceBody = z.strictObject({
  role: Role,
  publicKeySpkiB64: Base64.max(1024),
  label: z.string().min(1).max(64),
});
export type RegisterDeviceBody = z.infer<typeof RegisterDeviceBody>;
export const RegisterDeviceResponse = z.object({ deviceKeyId: z.string() });

const UINT96_MAX = (1n << 96n) - 1n;
export const CreateRentalBody = z.strictObject({
  ownerAddress: Address,
  renterAddress: Address.optional(),
  depositUsdt: UintString.refine((s) => BigInt(s) > 0n && BigInt(s) <= UINT96_MAX, "deposit must fit uint96 and be > 0"),
  returnBy: IsoDateTime,
  scheduleBps: z.tuple([z.literal(0), Bps, Bps, Bps]),
  item: z.string().min(1).max(120),
});
export type CreateRentalBody = z.infer<typeof CreateRentalBody>;
/** txHash is absent when renterAddress was not given: createRental is then sent at funding time. */
export const CreateRentalResponse = z.object({ rentalId: Bytes32, payUrl: z.url(), txHash: Bytes32.optional() });

/** GET /payment-config (additive): what the pay page needs to sign the EIP-3009 authorization. */
export const PaymentConfig = z.object({
  chainId: z.number().int(),
  depositsAddress: Address,
  usdt: z.object({ address: Address, decimals: z.number().int() }),
  /** EIP-712 domain verified against USDT's DOMAIN_SEPARATOR(); sign with exactly these fields. */
  domain: z.object({
    name: z.string(),
    version: z.string(),
    chainId: z.number().int().optional(),
    verifyingContract: Address,
    salt: Bytes32.optional(),
  }),
});
export type PaymentConfig = z.infer<typeof PaymentConfig>;

/** EIP-3009 ReceiveWithAuthorization signed by the renter (section 6). */
export const FundBody = z.strictObject({
  from: Address,
  validAfter: UintString,
  validBefore: UintString,
  nonce: Bytes32,
  v: z.number().int().min(27).max(28),
  r: Bytes32,
  s: Bytes32,
});
export type FundBody = z.infer<typeof FundBody>;

export const TxResponse = z.object({ txHash: Bytes32 });

/** Non-file fields of the multipart scan upload, after JSON.parse of `manifest`. Files: front..detail. */
export const ScanUploadFields = z.object({ manifest: Manifest, signature: Base64 });
export const ScanUploadResponse = z.object({ manifestHash: Bytes32, txHash: Bytes32.optional() });

export const ConfirmBody = z.strictObject({ address: Address, signature: EvmSignature });
export type ConfirmBody = z.infer<typeof ConfirmBody>;
export const ConfirmResponse = z.object({ ok: z.boolean(), txHash: Bytes32.optional() });

export const AppealBody = ConfirmBody;

export const VerifyManifestBody = z.strictObject({ manifest: DebugManifest, signature: Base64.max(512) });
export type VerifyManifestBody = z.infer<typeof VerifyManifestBody>;
export const VerifyManifestResponse = z.object({
  ok: z.boolean(),
  manifestHash: Bytes32.optional(),
  error: z.string().optional(),
});
export type VerifyManifestResponse = z.infer<typeof VerifyManifestResponse>;

export const Health0gResponse = z.object({ router: z.boolean(), storage: z.boolean() });
