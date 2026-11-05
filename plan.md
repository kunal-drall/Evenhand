# Evenhand plan

Living plan for the team. Update it whenever a chunk lands, a decision is made or the plan changes.
Sources: `docs/ai/PRD.md` (what and why), `docs/ai/BUILD_PROMPT.md` (who builds what), `docs/interfaces.md` (the only spec).

Last updated: Fri 6 Nov 2026, 05:55 IST. Submissions close **Sat 7 Nov, 09:00 IST**; we submit by 08:00.

## 1. What we are building

Evenhand is a neutral inspector for rental deposits. Owner and renter scan the item with a phone at pickup and at return. A sealed 0G vision model decides whether there is new damage. The deposit sits in USDT in a Whitechain contract, which pays it out by that verdict: capture to the owner by the damage schedule, the rest to the renter.

- **One line:** both sides scan, a sealed AI decides, the deposit settles itself.
- **Why it matters:** today the side that inspects is the side that keeps the money (Hertz/UVeye phantom-damage bills of $300–$960; a congressional letter, Aug 2025). Stablecoin deposits have no dispute process at all.
- **Prizes:** 0G Physical AI (Agents with a Body), Whitechain Operate (stablecoin payments for business), and Whitechain Scale if the renter sees zero crypto steps.
- **Not:** a drive-through scanner, insurance or a marketplace. It sits beside a rental and holds the deposit.
- **Demo item:** one laptop with a cheap vinyl skin on the lid, so the scratch never touches the laptop. The same laptop is used for all three demo rentals.

## 2. How it works

```
iPhone (owner) ─┐                          ┌─> 0G Router (sealed vision model, verify_tee)
iPhone/web      ├─> Evenhand server ───────┼─> 0G Storage (encrypted photos + inspection log)
(renter)       ─┘   API · inspector ·      └─> Whitechain: EvenhandDeposits (USDT deposit)
                    relayer (pays gas)
```

1. **Create and pay.** The owner sets the item, deposit, return deadline and damage schedule (for example minor 10%, moderate 35%, major 100%). The server creates the rental onchain and returns a pay link. The renter's browser makes a burner key and signs one EIP-3009 `receiveWithAuthorization`; the relayer submits it and pays the gas.
2. **Pickup.** The iOS app guides six camera-only shots. It hashes each photo, builds a manifest and signs it with a Secure Enclave key. The renter co-signs. The pickup manifest hash goes onchain.
3. **Return.** Six more shots. The return manifest hash goes onchain, and the inspection starts.
4. **Verdict.** One 0G call with all six pickup/return pairs, then rules (`RULES_V1`), then the inspection log on 0G Storage (its root is `inspectionRoot`), then `proposeVerdict` onchain. After the appeal window anyone can `finalize`, which makes two USDT transfers in one transaction.
5. **Exceptions.** 0G unreachable means "Inspection paused": nothing is guessed and the deposit stays held. Low confidence or an unusable angle goes to the arbiter. No verdict by `returnBy + grace` means a full refund to the renter, callable by anyone. The owner can waive at any time. Either side can appeal inside the window (P1).

**Laptop shots map onto the spec's fixed angle IDs** (the IDs never change; the app only shows these labels):

| Angle ID | Laptop shot |
|---|---|
| `front` | screen open, showing a full white page (shows cracks and dead pixels) |
| `back` | base (underside) |
| `left` | left side |
| `right` | right side |
| `top` | lid, outside (vinyl skin) |
| `detail` | keyboard and palm rest |

## 3. Requirements and who owns them

| ID | Requirement | Pri | Chunk |
|---|---|---|---|
| R1 | Owner creates rental (deposit, schedule, deadline); terms hash onchain | P0 | C1, C4, C3 |
| R2 | Renter pays USDT with one signature, no gas | P0 | C1a, C1, C4, C5 |
| R3 | Six fixed angles, camera only, Secure Enclave-signed manifest | P0 | C3a, C3 |
| R4 | Pickup confirmed by both phones; manifest hash onchain | P0 | C3, C4, C5 |
| R5 | Return scan by owner, visible to renter; hash onchain | P0 | C3, C4 |
| R6 | Sealed 0G vision verdict with `request_id` | P0 | C2, C4 |
| R7 | Inspection log on 0G Storage; root in the event | P0 | C2, C4 |
| R8 | Settle: capture to owner, rest to renter, one tx | P0 | C1 |
| R9 | Safe stop: 0G down or low confidence means nothing settles; "Inspection paused" | P0 | C4, C3 |
| R10 | Timeout refund after `returnBy + grace` | P0 | C1, C4 |
| R11 | Appeal window and arbiter | P1 | C1, C7b |
| R12 | Contract checks 0G provider TEE signature | P1 | C7a |
| R13 | Drop-in SDK; demo shop in about 20 lines | P1 | C7b |
| R14 | CSV export for an accountant | P1 | C7b |
| R15 | QR tag in every shot | P1 | C7c |
| R16 | Replay a verdict from its 0G Storage log | P1 | C7c |
| R17–R18 | App Attest; 0G account sign-in | P2 | cut |

Out of scope: Android, fiat on-ramps, insurance, multi-item rentals, marketplace, mainnet, faults photos cannot show (battery, drive).

## 4. Timeline (IST)

| By | Milestone | Owner | Status |
|---|---|---|---|
| Thu 23:59 | Repo scaffolded, interfaces + shared schemas | Kunal | done 00:40 (branch `c0-scaffold`) |
| Fri 03:00 | 0G spike: JSON verdict, `request_id`, `tee_verified`, storage root | Kunal | code done 01:20; live run needs keys |
| Fri 03:00 | USDT spike: `receiveWithAuthorization` lands on chain 1874 | Solidity dev | not in repo yet |
| Fri 03:00 | Capture spike: Secure Enclave signature verified by server | Swift dev | server side ready |
| Fri 10:00 | Contract complete, tested, deployed, verified | Solidity dev | tested 04:30; deploy needs keys |
| Fri 14:00 | Happy path end to end | All | |
| Fri 20:00 | Safe stop, timeout, waive, appeal, export, SDK, shop | All | |
| Fri 23:00 | P1 stretch: TEE check, QR tag, replay | whoever is free | |
| Sat 02:00 | Feature freeze, review, README, feedback file | Kunal | |
| Sat 05:00 | Demo video (2–3 min, narrated) | Kunal | |
| Sat 08:00 | Submitted | Kunal | |

## 5. Chunks and status

| ID | Chunk | Owner | Status | Branch / PR |
|---|---|---|---|---|
| C0 | Scaffold: workspace, shared schemas, server stubs, web skeleton, Foundry | Kunal | **done** (build, 17 tests, forge pass) | `c0-scaffold` (PR waits for `gh auth login`) |
| C2 | 0G spike: models, one vision call, storage upload | Kunal | **code done**: model list verified live; chat call and storage upload wait for `.env` keys (`pnpm -C server spike:0g`) | `c2-spike-0g` |
| C1a | USDT authorization spike | Solidity dev | **facts verified on chain** (`docs/spikes/usdt.md`: TetherTokenV2, 6 decimals, domain v1, v/r/s overload present); first real pull waits for funding | `c8-review-fixes` |
| C3a | Capture spike (iOS) | Swift dev | server route `/debug/verify-manifest` ready | |
| C1 | `EvenhandDeposits` + tests + deploy + verify | Solidity dev | **written as a fallback** (no contract from the team in the repo by 04:00): 26 Foundry tests incl. fuzz; full flow on anvil via `sh scripts/anvil-e2e.sh`; deploy + verify on 1874 waits for keys | `c1-contract` |
| C4 | Server: API, inspector, rules, storage log, relayer, safe stop | Kunal | **code done**: 67 tests (fake chain/0G/storage); live run `pnpm -C server e2e` waits for keys + deployed contract | `c4-server` |
| C3 | iOS app | Swift dev | `ios/EvenhandCore` Swift package ready (canonical JSON, manifest, Secure Enclave signer, API client; verified against the fixture and Node). The SwiftUI app itself needs Xcode | `c3-ios-core` |
| C5 | Web: pay, confirm, status, owner dashboard | Kunal | **code done**: full flow verified against the simulator; one-tap pay verified in headless Chrome; phone check on testnet pending | `c5-web` |
| C6 | End to end on testnet | All | | |
| C7a | TEE signature check | Solidity dev + Kunal | needs C2 finding | |
| C7b | Appeal, arbiter, CSV, SDK, shop | Kunal | **mostly done**: CSV export, arbiter queue + page (`resolveAppeal` via arbiter wallet), SDK + `/shop`, pay QR. User-initiated appeal is blocked on a contract change (decisions log) | `c7b-export-sdk-arbiter` |
| C7c | QR tag, replay | Swift dev + Kunal | **replay done** (`pnpm -C server replay <root>`; matches the logged decision in tests); QR tag is iOS work | `c7c-replay` |
| C8 | Fresh-eyes review | Solidity dev | **done 05:30** (two independent reviews: contract and server money paths). All critical, high and medium findings fixed with tests; the rest is in README "Known limitations" | `c8-review-fixes` |
| C9 | README, feedback file, AI-use table, submission | Kunal | **README draft done** (TBD placeholders for addresses, links, IDs, team); MIT licence; `docs/spikes/demo-run.md` template; WHITECHAIN_FEEDBACK waits for Kunal's notes | `c9-docs` |

Each feature lands as a branch, then a PR, then a merge. Commits are small and named `<area>: <what changed>`.

## 6. Decisions log

| Date | Decision | Why |
|---|---|---|
| 11-06 | Keep the spec's angle IDs; map laptop shots in the app (table in section 2) | `interfaces.md` is frozen; the IDs are generic |
| 11-06 | Contracts use Soldeer (forge-std 1.17.0, OpenZeppelin 5.7.0) instead of git submodules | submodule packs break on the exFAT dev drive; `soldeer.lock` pins checksums |
| 11-06 | `/debug/verify-manifest` accepts 1–6 shots; real scan routes require exactly 6 | lets the one-photo capture spike pass |
| 11-06 | Device ID = `dk_` + first 32 hex of sha256(SPKI); registration is idempotent; P-256 only | stable IDs, no duplicate keys |
| 11-06 | `RentalView.renter` is nullable | `renterAddress` is optional at creation; C4 decides when the rental goes onchain |
| 11-06 | Minimal deps: tiny path router in web, no router library; own zod JSON helper in server | fewer packages to audit |
| 11-06 | 0G model choice: image in, text out, `response_format` supported, cheapest first; env overrides win | first pass at about $0.045/M input tokens (`qwen2.5-vl-72b-instruct`) |
| 11-06 | pnpm 12 `allowBuilds`: only better-sqlite3 and esbuild run install scripts | supply-chain hygiene |
| 11-06 | PRD's `qwen3-omni-flash` is not auto-picked: it lacks `response_format` | the inspection request needs JSON mode |
| 11-06 | Spike photos are synthetic (lid with and without a scratch); real laptop photos replace them for the demo | unblocks the 0G call before the iPhone app exists |
| 11-06 | No renter at creation: rental ID uses `address(0)` for the renter; `createRental` is sent at funding, with the renter = the authorization's `from`; `txHash` is then absent from `POST /rentals` | the renter's burner key only exists once they open the pay link; also no gas is spent until a valid, funded authorization arrives |
| 11-06 | One AES-256-GCM bundle per scan (six sealed JPEGs) is both the local copy and the single 0G Storage upload; `photoRoots.pickup/return` hold one root each | 7 sequential storage txs per return would delay the live verdict by minutes; 2 keep it under a minute |
| 11-06 | Funding is checked offchain first (EIP-712 signer, amount, validity, USDT balance); every tx is simulated and gas-capped before sending | a bad request never costs relayer gas |
| 11-06 | Inspector stages persist: inference, then storage log, then `proposeVerdict`; a retry resumes the failed stage only | a re-run 0G call could return a different verdict |
| 11-06 | `needs_human` gets a 0G Storage log but no onchain verdict (spec); the contract can only reach the arbiter via `Appealed` | flagged for C1: needs an inspector `escalate` path or the arbiter can't settle these |
| 11-06 | Additive endpoints: `GET /payment-config` (verified EIP-712 domain), `GET /rentals?owner=`, `GET /rentals/:id/photos/:phase/:angle` (decrypting proxy) | the web pages need them; spec routes unchanged |
| 11-06 | The server serves `web/dist` at `/pay`, `/r`, `/owner`, `/shop` | one cloudflared tunnel covers API and renter pages |
| 11-06 | Cost cap: estimate = rubric + 12 × 1,300 tokens/image + 700 out; refuse above `MAX_INSPECTION_COST_USD` | the token count per image is replaced once the C2 live call measures it |
| 11-06 | Contract written on `c1-contract` as a fallback; the Solidity dev reviews it or swaps in theirs | nothing from the team was pushed by 04:00 and every other chunk waits on it |
| 11-06 | Contract additions beyond the spec: `TeeSignerSet` event, public `teeSuffix()` view, balance-delta check on funding, `waive` on an unfunded rental cancels it (amount 0), owner ≠ renter | auditability and safety; no spec behaviour changed |
| 11-06 | EVM target `prague`, solc 0.8.30 | Whitechain testnet is op-reth with Prague header fields |
| 11-06 | Keeper reads `appealWindow`/`grace` from the deployed contract; server falls back to `deployments.json` for the address | no env drift after deploy |
| 11-06 | Renter key: created silently in the browser (localStorage); demo phones are set up once with `/pay/<id>#key=0x…` to import the pre-funded test renter key | a fresh key holds no test USDT; a real product needs an on-ramp or the renter's own wallet |
| 11-06 | Renter UI shows dollars and "receipts" only: no chain name, gas, token symbol or seed phrase | Whitechain Scale criteria |
| 11-06 | Renter-initiated appeal is not built: `appeal(id)` must be sent by the owner or renter, and the renter has no gas. Needs a signature-based `appealWithSig` in the contract (relayer-sent), plus an allowlist entry | "renter never pays gas" and the section 10 allowlist both rule out the alternatives |
| 11-06 | Arbiter resolves from their own wallet on `/arbiter` (`resolveAppeal`), not through the server | arbiter is not one of the two server keys (section 10) |
| 11-06 | Replay re-applies RULES_V1 to the logged outputs of every pass (deterministic); `--rerun` makes a fresh 0G call, which may differ | the logged run is the evidence; a new model run is a second opinion |
| 11-06 | CSV amounts are in USDT units (e.g. `200`, `70`), not base units | it's for an accountant |
| 11-06 | `pnpm -C server dev:fake`: the real app on a fake chain and fake storage (real 0G if keyed), 60 s appeal window | UI and iOS work before deploy; demo fallback rehearsal |

### Deviations from `docs/interfaces.md` v1 (pending team approval; then bump the spec to v1.1)

| Area | v1 says | Now | Why |
|---|---|---|---|
| Contract `Rental` | 13 fields | + `returnedAt` (appended) | no-verdict timeout for a late return (review H1) |
| Contract | no `escalate` | `escalate(id)`: inspector Returned → Appealed; anyone PickedUp → Appealed after `returnBy + grace` | arbiter path for `needs_human`; an unreturned item no longer refunds the renter (H1, H2) |
| `refundOnTimeout` | from Funded, PickedUp, Returned after `returnBy + grace` | Funded after `returnBy + grace`; Returned after `max(returnBy, returnedAt) + grace`; not PickedUp | H1 |
| EIP-3009 nonce (section 6) | random 32 bytes | `fundingNonce(id) = keccak256(abi.encode(contract, id))` | one rental's authorization cannot fund another (M1) |
| Section 10 allowlist | inspector: create, pickup, return, propose | + `escalate` | H2 |
| `POST /rentals` | returns `txHash` | never sends a tx; `createRental` at funding | no unauthenticated gas spend |
| `POST /rentals` body | | + optional `ownerDeviceKeyId` | scans only from the owner's device |
| `ScanView.photoUrls` | proxied URLs | + per-scan `?t=` token | photos are not readable from the rental ID alone |
| Additive endpoints | | `GET /payment-config`, `GET /rentals?owner=` and `?queue=arbiter` (operator token), photo proxy | web pages |
| `InspectionLog` | | + `passes[]`, `decision.reason`; `parsed` nullable | exact replay |

## 7. Sponsor checklist (tick when done, with link)

**0G Physical AI:** 0G call decides every verdict · inspection log on 0G Storage with `request_id` · replay or live hardware demo · safe stop that never fakes a verdict · README line "Without a sealed, attested model, the verdict is the owner's word again" · public repo, video under 3 minutes, live link, addresses, contacts.

**Whitechain Operate:** deployed and verified on chain 1874 · official test USDT payment in the main flow, with explorer link · README line on why onchain settlement · SDK and demo shop · owner and renter views · partial capture, refund and export · steady commit history · 2–4 minute video · `WHITECHAIN_FEEDBACK.md` · reads as a merchant deposit product, not bare escrow.

**Whitechain Scale:** renter never holds WBT, sees a chain name or a seed phrase · README explains who pays gas and why the relayer can't be drained.

**ETHGlobal:** partner prizes 0G and Whitechain · no pre-kickoff code · AI use documented down to files under `docs/ai/` · narrated video, not sped up, not filmed on a phone.

## 8. Cut order if time runs short

1. App Attest and 0G sign-in. 2. Scale entry. 3. Replay, then QR tag. 4. Onchain TEE check (say so in README). 5. SDK and demo shop.
**Never cut:** safe stop, timeout refund, the 0G Storage inspection log.

## 9. Environment notes

- Toolchain: Node 22 (`.nvmrc`), pnpm 12, Foundry 1.9. `pnpm -r build`, `pnpm -C server test`, `cd contracts && forge build`.
- On an exFAT/FAT drive macOS writes `._*` files that break forge and git: run `pnpm clean:appledouble` first.
- Server needs a public URL for the phones: `cloudflared tunnel --url http://localhost:8787`, then set `PUBLIC_BASE_URL`. The server also serves the web build (`pnpm -C web build` first), so one tunnel covers the API and the pages.
- Run modes: `pnpm -C server dev` (real testnet, needs `.env`), `pnpm -C server dev:fake` (simulator), `pnpm -C web dev` (UI hot reload; proxies the API to :8787).
- Live checks: `pnpm -C server spike:0g` (0G only), `pnpm -C server e2e` (full flow against a running server).
- Local chain check (no keys): `sh scripts/anvil-e2e.sh` runs the real contract and server chain code on anvil.
- Keys: `sh scripts/new-env.sh` writes a fresh `.env` (prints addresses to fund, never keys). Readiness: `pnpm -C server preflight`.
- Deploy: `cd contracts && forge script script/Deploy.s.sol --rpc-url whitechain --broadcast --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` (needs `DEPLOYER_PRIVATE_KEY`, `INSPECTOR_PRIVATE_KEY`, `ARBITER_ADDRESS`, `WC_RPC_URL`).
