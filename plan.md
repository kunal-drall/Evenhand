# Evenhand plan

Living plan for the team. Update it whenever a chunk lands, a decision is made or the plan changes.
Sources: `docs/ai/PRD.md` (what and why), `docs/ai/BUILD_PROMPT.md` (who builds what), `docs/interfaces.md` (the only spec).

Last updated: Fri 6 Nov 2026, 01:10 IST. Submissions close **Sat 7 Nov, 09:00 IST**; we submit by 08:00.

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
| Fri 03:00 | 0G spike: JSON verdict, `request_id`, `tee_verified`, storage root | Kunal | in progress |
| Fri 03:00 | USDT spike: `receiveWithAuthorization` lands on chain 1874 | Solidity dev | not in repo yet |
| Fri 03:00 | Capture spike: Secure Enclave signature verified by server | Swift dev | server side ready |
| Fri 10:00 | Contract complete, tested, deployed, verified | Solidity dev | |
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
| C2 | 0G spike: models, one vision call, storage upload | Kunal | **in progress**: model list done; chat and storage need `.env` keys | `c2-spike-0g` |
| C1a | USDT authorization spike | Solidity dev | not started in repo | |
| C3a | Capture spike (iOS) | Swift dev | server route `/debug/verify-manifest` ready | |
| C1 | `EvenhandDeposits` + tests + deploy + verify | Solidity dev | empty contract scaffolded | |
| C4 | Server: API, inspector, rules, storage log, relayer, safe stop | Kunal | next | |
| C3 | iOS app | Swift dev | | |
| C5 | Web: pay, confirm, status, owner dashboard | Kunal | | |
| C6 | End to end on testnet | All | | |
| C7a | TEE signature check | Solidity dev + Kunal | needs C2 finding | |
| C7b | Appeal, arbiter, CSV, SDK, shop | Kunal | | |
| C7c | QR tag, replay | Swift dev + Kunal | | |
| C8 | Fresh-eyes review | Solidity dev | | |
| C9 | README, feedback file, AI-use table, submission | Kunal | | |

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
- Server needs a public URL for the phones: `cloudflared tunnel --url http://localhost:8787`, then set `PUBLIC_BASE_URL`.
