// Operator actions (arbiter resolve, owner waive) are sent from the operator's own browser wallet;
// they are not relayed by the server, whose keys may only call the section 10 allowlist.
import { WHITECHAIN_TESTNET, evenhandDepositsAbi } from "@evenhand/shared";
import { createWalletClient, custom, defineChain, type EIP1193Provider } from "viem";
import { api } from "./api";

const chain = defineChain({
  id: WHITECHAIN_TESTNET.chainId,
  name: "Whitechain Testnet",
  nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: [WHITECHAIN_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: WHITECHAIN_TESTNET.explorerUrl } },
});

type OperatorCall = { functionName: "resolveAppeal"; args: [`0x${string}`, bigint] } | { functionName: "waive"; args: [`0x${string}`] };

/** Sends one deposits-contract call from the injected wallet (e.g. MetaMask), switching to Whitechain first. */
export async function sendFromOperatorWallet(call: OperatorCall): Promise<string> {
  const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("Open this page in a browser with your operator wallet.");
  const config = await api.paymentConfig();
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("No wallet account selected.");
  try {
    await wallet.switchChain({ id: chain.id });
  } catch {
    await wallet.addChain({ chain });
  }
  return wallet.writeContract({ account, address: config.depositsAddress as `0x${string}`, abi: evenhandDepositsAbi, ...call } as never);
}
