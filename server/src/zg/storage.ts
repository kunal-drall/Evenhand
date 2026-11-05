// 0G Storage (Galileo testnet) upload/download, server side only (docs/interfaces.md sections 1, 9).
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import { withTimeout } from "../net.js";

export type StorageConfig = { rpcUrl: string; indexerUrl: string; privateKey: string };

// The SDK's .d.ts files resolve ethers' CommonJS typings while this ESM module gets the ESM ones; at runtime
// both are the same ESM build of ethers 6.13.1, so only the declared types differ.
type SdkSigner = Parameters<Indexer["upload"]>[2];

const UPLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Merkle root of the bytes as 0G Storage computes it (no network). */
export async function storageRoot(bytes: Uint8Array): Promise<string> {
  const [tree, err] = await new MemData(bytes).merkleTree();
  const root = tree?.rootHash();
  if (err || !root) throw new Error(`merkle tree failed: ${err?.message ?? "empty root"}`);
  return root;
}

/** Uploads bytes and returns their storage root and the Galileo tx hash. */
export async function uploadBytes(cfg: StorageConfig, bytes: Uint8Array): Promise<{ rootHash: string; txHash: string }> {
  const signer = new Wallet(cfg.privateKey, new JsonRpcProvider(cfg.rpcUrl)) as unknown as SdkSigner;
  const indexer = new Indexer(cfg.indexerUrl);
  const [result, err] = await withTimeout(indexer.upload(new MemData(bytes), cfg.rpcUrl, signer), UPLOAD_TIMEOUT_MS, "0G Storage upload");
  if (err) throw new Error(`0G Storage upload failed: ${err.message}`);
  if (!("rootHash" in result)) throw new Error("0G Storage split the upload into fragments; expected one root");
  return { rootHash: result.rootHash, txHash: result.txHash };
}

/** Downloads by root with Merkle proof verification. */
export async function downloadBytes(indexerUrl: string, rootHash: string): Promise<Buffer> {
  const indexer = new Indexer(indexerUrl);
  const [blob, err] = await withTimeout(indexer.downloadToBlob(rootHash, { proof: true }), DOWNLOAD_TIMEOUT_MS, "0G Storage download");
  if (err) throw new Error(`0G Storage download failed: ${err.message}`);
  return Buffer.from(await blob.arrayBuffer());
}
