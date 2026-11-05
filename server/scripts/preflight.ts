// Live-run checklist: keys, balances, contract, 0G Router and Storage, tunnel, web build. Prints no secrets.
//   pnpm -C server preflight
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { evenhandDepositsAbi, usdtAbi } from "@evenhand/shared";
import { createPublicClient, formatEther, formatUnits, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { matchDomain } from "../src/chain/port.js";
import { loadConfig, type Hex } from "../src/config.js";
import { loadDotEnv } from "../src/env-file.js";
import { fetchWithTimeout, withTimeout } from "../src/net.js";
import { listVisionModels, pickModels } from "../src/zg/models.js";

loadDotEnv();
const env = process.env;
const config = loadConfig();
let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string, fix: string) => {
  failures += 1;
  console.log(`  ✗ ${msg}\n      → ${fix}`);
};
const warn = (msg: string) => console.log(`  ! ${msg}`);
const address = (key: string | undefined) => (key ? privateKeyToAccount(key as Hex).address : undefined);

console.log("Keys and settings");
for (const [name, fix] of [
  ["ZG_API_KEY", "0G Router inference key (sk-...) from https://pc.0g.ai"],
  ["ZG_STORAGE_PRIVATE_KEY", "sh scripts/new-env.sh, or add a Galileo key"],
  ["INSPECTOR_PRIVATE_KEY", "sh scripts/new-env.sh"],
  ["RELAYER_PRIVATE_KEY", "sh scripts/new-env.sh"],
  ["ARBITER_ADDRESS", "sh scripts/new-env.sh"],
  ["OPERATOR_TOKEN", "16+ random characters"],
] as const) {
  if (env[name]) ok(`${name} set`);
  else bad(`${name} missing`, fix);
}
if (/localhost|127\.0\.0\.1/.test(config.publicBaseUrl)) warn(`PUBLIC_BASE_URL is ${config.publicBaseUrl}: phones need the cloudflared tunnel URL`);
else ok(`PUBLIC_BASE_URL ${config.publicBaseUrl}`);
if (existsSync(fileURLToPath(new URL("../../web/dist/index.html", import.meta.url)))) ok("web build present (served at /pay, /r, /owner, /shop, /arbiter)");
else bad("web/dist missing", "pnpm -C web build");

console.log("Whitechain");
const client = createPublicClient({ transport: http(config.chain.rpcUrl, { timeout: 15_000 }) });
try {
  const chainId = await client.getChainId();
  if (chainId === config.chain.chainId) ok(`RPC reachable, chain ${chainId}`);
  else bad(`RPC chain ${chainId}`, `expected ${config.chain.chainId}`);
  const gas = async (label: string, who: Address | undefined, min: bigint) => {
    if (!who) return;
    const bal = await client.getBalance({ address: who });
    if (bal >= min) ok(`${label} ${who} holds ${formatEther(bal)} WBT`);
    else bad(`${label} ${who} holds ${formatEther(bal)} WBT`, "fund it at https://faucet.testnet.whitechain.io");
  };
  await gas("deployer", address(env.DEPLOYER_PRIVATE_KEY), 10n ** 17n);
  await gas("inspector", address(config.chain.inspectorKey), 10n ** 18n);
  await gas("relayer", address(config.chain.relayerKey), 10n ** 18n);

  const read = <F extends "name" | "decimals" | "DOMAIN_SEPARATOR">(functionName: F) => client.readContract({ address: config.chain.usdt, abi: usdtAbi, functionName });
  const [name, decimals, separator] = await Promise.all([read("name"), read("decimals"), read("DOMAIN_SEPARATOR")]);
  const domain = matchDomain(name as string, separator as Hex, config.chain.chainId, config.chain.usdt);
  if (domain) ok(`USDT "${name}", ${decimals} decimals, EIP-712 domain version ${domain.version} matches DOMAIN_SEPARATOR`);
  else bad("USDT DOMAIN_SEPARATOR matches no known domain", "record the real domain in docs/spikes/usdt.md (C1a)");
  const renter = address(env.TEST_RENTER_PRIVATE_KEY);
  if (renter) {
    const usdt = await client.readContract({ address: config.chain.usdt, abi: usdtAbi, functionName: "balanceOf", args: [renter] });
    if (usdt > 0n) ok(`test renter ${renter} holds ${formatUnits(usdt, Number(decimals))} USDT`);
    else bad(`test renter ${renter} holds no USDT`, "ask the Whitechain booth for test USDT");
  }

  const deposits = config.chain.deposits;
  if (!deposits) bad("EvenhandDeposits not deployed", "deploy (plan.md section 9); the server then reads deployments.json");
  else if ((await client.getCode({ address: deposits }))?.length) {
    const r = <F extends "inspector" | "arbiter" | "appealWindow" | "grace">(functionName: F) =>
      client.readContract({ address: deposits, abi: evenhandDepositsAbi, functionName }) as Promise<unknown>;
    const [inspector, arbiter, window, grace] = await Promise.all([r("inspector"), r("arbiter"), r("appealWindow"), r("grace")]);
    ok(`EvenhandDeposits at ${deposits} (appeal window ${window} s, grace ${grace} s)`);
    if (String(inspector).toLowerCase() === address(config.chain.inspectorKey)?.toLowerCase()) ok("contract inspector = INSPECTOR_PRIVATE_KEY");
    else bad(`contract inspector is ${inspector}`, "INSPECTOR_PRIVATE_KEY must be the key the contract was deployed with");
    if (config.chain.arbiter && String(arbiter).toLowerCase() !== config.chain.arbiter.toLowerCase()) bad(`contract arbiter is ${arbiter}`, "ARBITER_ADDRESS mismatch");
  } else bad(`no contract code at ${deposits}`, "check DEPOSITS_ADDRESS / deployments.json");
} catch (err) {
  bad(`Whitechain check failed: ${(err as Error).message.split("\n")[0]}`, "check WC_RPC_URL and the network");
}

console.log("0G");
try {
  const picked = pickModels(await listVisionModels(config.zg.routerUrl), { first: config.zg.model, strong: config.zg.modelStrong });
  ok(`Router reachable; first pass ${picked.first.id}, second pass ${picked.strong?.id ?? "none"}`);
  if (config.zg.apiKey) {
    const res = await fetchWithTimeout(
      `${config.zg.routerUrl}/chat/completions`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${config.zg.apiKey}`, "content-type": "application/json", "x-0g-provider-trust-mode": config.zg.trustMode },
        body: JSON.stringify({ model: picked.first.id, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      },
      30_000,
    );
    if (res.ok) ok(`ZG_API_KEY accepted (${config.zg.trustMode} trust mode)`);
    else bad(`Router rejected the key or model: HTTP ${res.status}`, (await res.text()).slice(0, 160));
  }
} catch (err) {
  bad(`0G Router check failed: ${(err as Error).message}`, "check ZG_ROUTER_URL and the network");
}
try {
  await withTimeout(new Indexer(config.storage.indexerUrl).getShardedNodes(), 10_000, "indexer");
  ok("0G Storage indexer reachable");
  const storageAddr = address(config.storage.privateKey);
  if (storageAddr) {
    const galileo = createPublicClient({ transport: http(config.storage.rpcUrl, { timeout: 15_000 }) });
    const bal = await galileo.getBalance({ address: storageAddr });
    if (bal > 10n ** 16n) ok(`storage key ${storageAddr} holds ${formatEther(bal)} 0G`);
    else bad(`storage key ${storageAddr} holds ${formatEther(bal)} 0G`, "fund it at https://faucet.0g.ai");
  }
} catch (err) {
  bad(`0G Storage check failed: ${(err as Error).message}`, "check ZG_STORAGE_INDEXER and ZG_STORAGE_RPC");
}

console.log(failures ? `\n${failures} item(s) to fix before the live run.` : "\nReady for the live run: pnpm -C server dev, then pnpm -C server e2e.");
process.exit(failures ? 1 : 0);
