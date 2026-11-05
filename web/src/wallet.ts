// The renter's key lives only in this browser. It is created silently on first visit; the renter never
// sees it, a seed phrase, or gas. Demo setup: opening any page with `#key=0x...` imports a pre-funded test key.
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const STORAGE_KEY = "evenhand.renterKey.v1";
const KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function readStored(): `0x${string}` | undefined {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && KEY_PATTERN.test(v) ? (v as `0x${string}`) : undefined;
  } catch {
    return undefined;
  }
}

function store(key: `0x${string}`): void {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // private mode: key lives for this page only
  }
}

/** Imports `#key=0x…` from the URL once, then strips it from the address bar. */
function importFromHash(): `0x${string}` | undefined {
  const match = /(?:^#|&)key=(0x[0-9a-fA-F]{64})/.exec(window.location.hash);
  if (!match) return undefined;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return match[1] as `0x${string}`;
}

let account: PrivateKeyAccount | undefined;

export function renterAccount(): PrivateKeyAccount {
  if (account) return account;
  const key = importFromHash() ?? readStored() ?? generatePrivateKey();
  store(key);
  account = privateKeyToAccount(key);
  return account;
}
