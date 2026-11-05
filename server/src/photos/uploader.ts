import type { Phase } from "@evenhand/shared";
import type { Repo } from "../rentals/repo.js";
import type { StoragePort } from "../zg/ports.js";
import type { BundleStore } from "./store.js";

export type EnsureBundleRoot = (rentalId: string, phase: Phase) => Promise<string>;

/** Uploads a scan's encrypted bundle to 0G Storage once and records its root; concurrent callers share the upload. */
export function createBundleUploader(repo: Repo, bundles: BundleStore, storage: StoragePort | undefined): EnsureBundleRoot {
  const inflight = new Map<string, Promise<string>>();
  return (rentalId, phase) => {
    const scan = repo.getScan(rentalId, phase);
    if (scan?.bundleRoot) return Promise.resolve(scan.bundleRoot);
    if (!scan) return Promise.reject(new Error(`no ${phase} scan for ${rentalId}`));
    const key = `${rentalId}:${phase}:${scan.manifestHash}`;
    const pending = inflight.get(key);
    if (pending) return pending;
    const run = (async () => {
      if (!storage) throw new Error("0G Storage key (ZG_STORAGE_PRIVATE_KEY) is not configured");
      const bundle = bundles.read(rentalId, phase);
      if (!bundle) throw new Error(`no local ${phase} photos for ${rentalId}`);
      const { rootHash } = await storage.upload(bundle);
      repo.setScanBundleRoot(rentalId, phase, rootHash, scan.manifestHash);
      return rootHash;
    })().finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
  };
}
