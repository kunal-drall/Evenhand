// Arbiter queue: verdicts the contract routed to a human (Appealed) and inspections that need one (needs_human).
// The arbiter resolves with their own wallet: resolveAppeal(id, capture) on the deposits contract.
import { useState } from "react";
import { WHITECHAIN_TESTNET, evenhandDepositsAbi, type RentalView } from "@evenhand/shared";
import { createWalletClient, custom, defineChain, parseUnits, type EIP1193Provider } from "viem";
import { api } from "../api";
import { Notice, Photos, Shell, Verdict } from "../components";
import { usd } from "../format";
import { usePolling } from "../usePolling";

const chain = defineChain({
  id: WHITECHAIN_TESTNET.chainId,
  name: "Whitechain Testnet",
  nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: [WHITECHAIN_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: WHITECHAIN_TESTNET.explorerUrl } },
});

async function resolveAppeal(id: string, capture: bigint): Promise<string> {
  const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("Open this page in a browser with the arbiter's wallet.");
  const config = await api.paymentConfig();
  const wallet = createWalletClient({ chain, transport: custom(provider) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("No wallet account selected.");
  try {
    await wallet.switchChain({ id: chain.id });
  } catch {
    await wallet.addChain({ chain });
  }
  return wallet.writeContract({
    account,
    address: config.depositsAddress as `0x${string}`,
    abi: evenhandDepositsAbi,
    functionName: "resolveAppeal",
    args: [id as `0x${string}`, capture],
  });
}

function Case({ rental, decimals, onDone }: { rental: RentalView; decimals: number; onDone: () => void }) {
  const proposed = rental.inspection?.capture ? Number(rental.inspection.capture) / 10 ** decimals : 0;
  const [amount, setAmount] = useState(String(proposed));
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string }>();
  const appealed = rental.state === "Appealed";

  async function submit() {
    try {
      const capture = parseUnits(amount, decimals);
      if (capture > BigInt(rental.deposit)) throw new Error("Capture cannot exceed the deposit.");
      const hash = await resolveAppeal(rental.rentalId, capture);
      setResult({ tone: "ok", text: `Sent: ${hash}` });
      onDone();
    } catch (err) {
      setResult({ tone: "error", text: (err as Error).message });
    }
  }

  return (
    <section className="card">
      <p className="eyebrow">
        {usd(rental.deposit, decimals)} deposit · {appealed ? "appealed to the arbiter" : "inspection needs a human"}
      </p>
      <h2>{rental.item}</h2>
      {rental.inspection?.reason && <Notice tone="warn">Reason: {rental.inspection.reason}</Notice>}
      <Verdict rental={rental} decimals={decimals} />
      {rental.scans.pickup && (
        <>
          <h3>Pickup</h3>
          <Photos scan={rental.scans.pickup} />
        </>
      )}
      {rental.scans.return && (
        <>
          <h3>Return</h3>
          <Photos scan={rental.scans.return} highlight={rental.inspection?.verdict?.angles.filter((a) => a.severity > 0).map((a) => a.angle)} />
        </>
      )}
      {appealed ? (
        <div className="form">
          <label>
            Capture for the owner (USD) <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </label>
          <button className="primary" onClick={() => void submit()}>
            Settle: owner gets {amount || 0}, renter gets the rest
          </button>
        </div>
      ) : (
        <p className="meta">No verdict is onchain for this rental. The owner can waive it, or it is refunded in full after the return deadline plus grace.</p>
      )}
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
    </section>
  );
}

export function ArbiterPage() {
  const { data, error, refresh } = usePolling(() => api.arbiterQueue(), 5000);
  const { data: cfg } = usePolling(() => api.paymentConfig(), 60_000);
  const decimals = cfg?.usdt.decimals ?? 6;
  return (
    <Shell wide>
      <section className="card">
        <h1>Arbiter</h1>
        <p className="meta">Cases the inspector would not settle on its own.</p>
      </section>
      {error && <Notice tone="error">{error}</Notice>}
      {data?.length === 0 && <p className="meta">Nothing waiting.</p>}
      {data?.map((r) => <Case key={r.rentalId} rental={r} decimals={decimals} onDone={() => void refresh()} />)}
    </Shell>
  );
}
