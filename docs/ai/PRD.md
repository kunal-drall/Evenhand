# Evenhand — Product Requirements

Nov 5, 2026 · @dev

## Summary

Evenhand is a neutral inspector for rental deposits. Owner and renter scan the item with a phone at pickup and at return, a sealed model on 0G decides whether there is new damage, and the deposit, held in USDT by a contract on Whitechain, is released or partly kept by that verdict.

|  |  |
| --- | --- |
| One line | Both sides scan, a sealed AI decides, the deposit settles itself |
| Partner picks | 0G (Physical AI: Agents with a Body) and Whitechain (Operate; Scale if the gasless flow is complete). No third pick: no other sponsor has a job in the product |
| Team | Three people: a Solidity developer, a Swift developer with two iPhones, and Kunal on the server, 0G and the pitch |
| Track | Classic, from scratch |
| Odds (my estimate, not data) | About 30–45% for at least one partner prize; 3–8% for the finals |

**Why this idea**

- **The problem is in the news.** Rental companies bill customers from AI damage scans that the customer cannot check, and a US congresswoman has asked Hertz why.
- **Each sponsor does a job the product needs.** 0G makes the verdict neutral and checkable. Whitechain makes it binding, because the money sits in a contract and not with the owner.
- **It fits what has won before.** A physical object on the table, a story judges already know, one sentence.
- **It uses the team.** Native iOS capture with keys held in the phone's secure chip, and two iPhones for owner and renter.

**What Evenhand is not:** a drive-through scanner, an insurance product, or a rental marketplace. It sits beside a rental and holds the deposit.

## Problem and evidence

When a deposit is disputed, the party that inspects the item is also the party that keeps the money. AI scanning has made that faster, not fairer.

- **Phantom damage bills.** Hertz began scanning returned cars with UVeye's AI system at six US airports in 2025. Customers reported bills of $300 to $960 for damage they say did not exist, and say they had no immediate way to dispute them. Sixt uses similar scanners ([WebProNews](https://www.webpronews.com/hertz-sixt-ai-scanners-trigger-phantom-damage-fee-disputes)).
- **Regulators are asking.** On 20 August 2025, Rep. Nancy Mace wrote to Hertz's CEO asking why it issues damage assessments without human review ([Straight Arrow News](https://san.com/cc/how-do-hertzs-ai-damage-scans-work-a-congresswoman-wants-to-know/)).
- **Fault is often not the renter's.** An excess-insurance seller reports that more than 58% of 1,710 rental damage claims it saw in 2025 were not caused by the renter. It sells the product it promotes, so treat the number as a signal ([CarInsuRent via National Law Review](https://natlawreview.com/press-releases/2025-rental-car-claims-data-reveals-structural-risk-58-damage-claims-not)).
- **Stablecoin deposits have no dispute process at all.** A law-firm note for merchants says stablecoin payments are generally irreversible and that merchants must build their own refund and dispute processes ([Venable, March 2026](https://www.venable.com/insights/publications/2026/03/stablecoins-an-emerging-consideration-for)).

**Who loses today**

- **Renters** pay charges they cannot check, and disputing them means weeks with a card issuer.
- **Small operators** cannot afford drive-through scanners, so they rely on their own photos, which renters do not trust.
- **Both sides** lose time, because neither has evidence the other accepts.

The gap Evenhand fills is a verdict neither side controls: evidence captured on a genuine device, judged by a model neither side runs, with the money held by neither side.

## Users, first market and business model

The paying customer is the rental operator; the renter is the reason the operator can charge for trust. Everything in this section past the user definitions is a hypothesis to test, not a finding.

| User | What they want | What Evenhand gives them |
| --- | --- | --- |
| Rental operator: small fleets and peer-to-peer hosts of cars, e-bikes, scooters, cameras, tools | Get paid for real damage without arguing | A verdict the renter cannot dismiss as the owner's own, and the deposit already in hand |
| Renter | Not pay for damage they did not cause | Their own signed photos at pickup, and a verdict the owner does not control |
| Rental platform (later) | Fewer support tickets on damage claims | An inspection and deposit API |

**First market (hypothesis)**

Operators too small for drive-through scanners, anywhere: e-bike and scooter rental shops, camera and equipment rental, peer-to-peer car hosts. Travellers without a credit card are a second wedge, because card holds need one and a USDT deposit does not.

**Revenue (hypothesis)**

- A fee per completed rental, charged to the operator and taken from the deposit at settlement, so nobody is invoiced.
- The fee also covers gas and inference, so the relayer never runs at a loss.
- Price to test: a flat fee per rental against a share of the deposit.

**Why it could become a business**

- The unit of value is a single rental, so it works for an operator with five bikes.
- Every inspection adds signed, timestamped evidence that is useful for insurance and resale later.
- Whitechain's Builders Program funds new builds up to $300K against milestones, judged on shipping and onchain metrics ([Builders Program](https://whitechain.io/builders)).

**Validate before building further**

- [ ] Ask ten rental operators how they handle damage disputes today and what they lose per year to them.
- [ ] Ask ten renters whether they would choose an operator that uses a neutral inspector.
- [ ] Ask both groups whether a USDT deposit is a reason to choose or a reason to leave.

## Scope and requirements

P0 is the demo: without every P0 row there is nothing to judge. P1 makes it competitive for the sponsors. P2 is after the hackathon unless time is left.

**In scope for Mumbai:** one item type demonstrated on stage: a laptop, one owner, one renter, two iPhones, Whitechain Sepolia, 0G Router and 0G Storage on testnet.

**Out of scope:** Android, fiat on-ramps, insurance, multi-item rentals, marketplace features, mainnet, and faults that photos cannot show, such as a weak battery or a failing drive.

| ID | Requirement | Priority | Done when |
| --- | --- | --- | --- |
| R1 | Owner creates a rental with deposit amount, damage schedule and return deadline | P0 | A rental exists onchain with its terms hash |
| R2 | Renter pays the deposit in USDT with one signature and no gas | P0 | A `receiveWithAuthorization` payment lands in the contract; explorer link in the README |
| R3 | Guided capture of six fixed angles in the iOS app, camera only (no photo library) | P0 | Six photos with a manifest signed by a Secure Enclave key |
| R4 | Pickup scan confirmed by both phones | P0 | The pickup manifest hash is recorded onchain |
| R5 | Return scan by the owner, visible to the renter | P0 | The return manifest hash is recorded onchain |
| R6 | Sealed 0G vision model compares pickup and return per angle and returns a structured verdict | P0 | A verdict with a 0G `request_id` for every inspection |
| R7 | Inspection log written to 0G Storage | P0 | A root hash per inspection, stored in the settlement event |
| R8 | Contract settles: capture to owner by the damage schedule, remainder to renter | P0 | Two USDT transfers in one settlement transaction |
| R9 | Safe stop: if 0G is unreachable or confidence is low, nothing settles automatically | P0 | Deposit stays held; the app shows "Inspection paused" |
| R10 | Timeout: no verdict by the deadline plus grace returns the full deposit | P0 | `refundOnTimeout` works after the grace period |
| R11 | Appeal window before a verdict becomes final; a human arbiter resolves appeals | P1 | An appealed verdict waits for the arbiter and settles by its decision |
| R12 | Contract checks the 0G provider's TEE signature on the verdict, not only Evenhand's key | P1 | Settlement rejects a verdict whose signature does not recover to the registered TEE signer |
| R13 | Drop-in SDK: a separate demo shop page creates a rental in about 20 lines | P1 | The demo shop page uses only the SDK |
| R14 | CSV export of settlements for an accountant | P1 | Export lists each rental, deposit, capture, refund, fee and transaction links |
| R15 | QR tag on the item, visible in every shot, ties photos to that item | P1 | A shot without the right tag is rejected at capture |
| R16 | Replay: re-run any verdict from its 0G Storage log | P1 | A script prints the same decision from the stored inputs |
| R17 | Apple App Attest proves photos came from the genuine app | P2 | The server rejects manifests without a valid assertion |
| R18 | Users sign in with a 0G account and spend their own iAI credits | P2 | Credit balance drops as inspections run |

## User flows

A rental passes through four moments: deposit, pickup, return, settlement. Every money movement waits for a verdict or a timeout, never for one party's word.

**1. Create the rental and pay the deposit**

1. The owner enters the item, deposit, return deadline and damage schedule (for example: minor 10%, moderate 35%, major 100% of the deposit).
2. The server creates the rental onchain and returns a payment link and QR code.
3. The renter opens the link on any phone. A wallet key is created in the browser; the renter sees only "Pay $200 deposit".
4. The renter signs a USDT `receiveWithAuthorization`; the relayer submits it and pays the gas. The deposit is now held by the contract.

**2. Pickup scan**

1. The owner sticks the rental's QR tag on the item and opens the rental in the iOS app.
2. The app guides six shots of the laptop (lid, base, screen showing a full white page, keyboard and palm rest, left side, right side), using the camera only. A white screen makes cracks and dead pixels visible.
3. The app hashes each photo, builds a manifest and signs it with a key held in the Secure Enclave.
4. The renter confirms the same scan on their phone, adding their own signature.
5. The server records the pickup manifest hash onchain and stores the encrypted photos on 0G Storage.

**3. Return scan**

1. The owner repeats the six shots. The renter can watch and add their own shots of anything they dispute.
2. The server records the return manifest hash onchain.

**4. Verdict and settlement**

1. The server sends each pickup and return pair to a sealed vision model on 0G and receives a structured verdict with a request ID.
2. Rules turn severity into an amount using the owner's schedule. Low confidence, a missing angle, or an automatic capture above the cap goes to a human instead.
3. The inspection log goes to 0G Storage; its root hash and the verdict are proposed onchain.
4. Both sides see the verdict, each damaged area marked, and the request ID.
5. After the appeal window, anyone can finalise: the capture goes to the owner and the rest to the renter in one transaction.

**Exceptions**

- **Appeal (P1):** either side appeals inside the window; the arbiter decides and the contract settles by that decision.
- **0G unreachable:** no verdict is produced and nothing is guessed. The deposit stays held and the app shows "Inspection paused" until 0G answers.
- **No verdict by the deadline plus grace:** anyone can trigger a full refund to the renter.
- **Owner waives the damage:** the owner can release the full deposit at any time.

## Architecture

The phones talk only to the Evenhand server. Its inspector gets the verdict from 0G and writes the log to 0G Storage; its relayer moves money only through the contract, which pays the owner and renter directly.

\[embedded content: Evenhand architecture · phones, server, 0G, Whitechain\]

The server is the one part both sides must still trust in this version: it prepares the photos and holds the inspector key. The P1 TEE signature check and, later, sending photos from the phone straight to sealed inference are what shrink that trust.

## System design

Five parts share one frozen interface file: a Solidity contract on Whitechain, a TypeScript server (API, inspector, relayer), a SwiftUI app, a small web app with an SDK, and a shared package of schemas. The build kit's `docs/interfaces.md` is the single source for every signature below.

**Repository layout**

| Path | What lives there | Stack |
| --- | --- | --- |
| `contracts/` | `EvenhandDeposits.sol`, tests, deploy and verify scripts | Foundry, Solidity 0.8.x |
| `server/` | API, inspector pipeline, relayer, 0G clients | Node 22, TypeScript, Hono, viem, SQLite |
| `ios/` | Capture app for owner and renter | SwiftUI, CryptoKit, AVFoundation |
| `web/` | Renter pay page, owner dashboard, demo shop, SDK | Vite, React, viem |
| `packages/shared/` | zod schemas, contract ABI, constants | TypeScript |
| `docs/` | `interfaces.md`, AI-use disclosure, sponsor files | Markdown |

**Verified network constants (checked 5 November 2026)**

| Item | Value |
| --- | --- |
| Whitechain Sepolia | Chain ID 1874, RPC `https://rpc.testnet.whitechain.io`, explorer `https://explorer.testnet.whitechain.io` (Blockscout), faucet `https://faucet.testnet.whitechain.io`, blocks about 1 second |
| USDT required by the prize | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, an EIP-1967 proxy to `TetherTokenV2`, whose verified source has `permit`, `transferWithAuthorization` and `receiveWithAuthorization`. Read `decimals()` at runtime |
| 0G Router | `https://router-api.0g.ai/v1`, header `Authorization: Bearer sk-…`, OpenAI-compatible `chat/completions`, images as `image_url` data URIs, 20 MB per request |
| 0G evidence | `verify_tee: true` in the body returns `x_0g_trace.request_id`, `provider`, `billing` and `tee_verified`; header `ZG-Res-Key` carries the chat ID for independent checks |
| 0G Storage | `@0gfoundation/0g-storage-ts-sdk`, server side only; Galileo testnet chain 16602, RPC `https://evmrpc-testnet.0g.ai`, indexer `https://indexer-storage-testnet-turbo.0g.ai` |

**Contract: `EvenhandDeposits`**

```solidity
enum State { None, Funded, PickedUp, Returned, Proposed, Appealed, Settled, Refunded }

function createRental(bytes32 id, address owner, address renter, uint96 deposit,
    uint40 returnBy, uint16[4] calldata scheduleBps, bytes32 termsHash) external; // inspector
function fundWithAuthorization(bytes32 id, uint256 validAfter, uint256 validBefore,
    bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;                // anyone (relayer)
function recordPickup(bytes32 id, bytes32 manifestHash) external;          // inspector
function recordReturn(bytes32 id, bytes32 manifestHash) external;          // inspector
function proposeVerdict(bytes32 id, uint8[6] calldata severity, uint16 confidenceBps,
    bytes32 inspectionRoot, bytes calldata teeText, bytes calldata teeSig) external; // inspector
function appeal(bytes32 id) external;                                      // owner or renter, in window
function resolveAppeal(bytes32 id, uint96 capture) external;               // arbiter
function finalize(bytes32 id) external;                                    // anyone, after window
function waive(bytes32 id) external;                                       // rental owner: full refund
function refundOnTimeout(bytes32 id) external;                             // anyone, after returnBy + grace
```

| From | To | Trigger | Who |
| --- | --- | --- | --- |
| None | Funded | `createRental` then `fundWithAuthorization` pulls the deposit with `receiveWithAuthorization` | Inspector, then relayer |
| Funded | PickedUp | Pickup manifest recorded | Inspector |
| PickedUp | Returned | Return manifest recorded | Inspector |
| Returned | Proposed | Verdict proposed; capture = deposit × `scheduleBps[max severity]` | Inspector |
| Returned | Appealed | Proposed capture above `autoCapBps`, or confidence below threshold | Contract, automatically |
| Proposed | Appealed | Appeal inside `appealWindow` | Owner or renter |
| Appealed | Settled | Arbiter sets the capture | Arbiter |
| Proposed | Settled | Window passes; capture to owner, rest to renter | Anyone |
| Any before Proposed | Refunded | `refundOnTimeout` after `returnBy + grace`, or `waive` | Anyone, or the rental owner |

`receiveWithAuthorization` is used rather than `transferWithAuthorization` because it only executes when called by the payee, so nobody can front-run the renter's signature. Events: `RentalCreated`, `Funded`, `PickupRecorded`, `ReturnRecorded`, `VerdictProposed(id, capture, inspectionRoot, requestIdHash)`, `Appealed`, `Settled(id, toOwner, toRenter, fee)`, `Refunded`. The export is built from these events.

**Verdict binding (P0, then P1)**

- **P0:** `proposeVerdict` accepts only the inspector key. The inspection root and request ID onchain let anyone re-check the run.
- **P1:** the contract also checks the 0G provider's signature. 0G's provider signs the response text with EIP-191, which a contract can check with `ecrecover`. The model ends its JSON with a canonical field such as `"eh":"EH1;<id>;0,0,2,0,0,0;87"`. The contract rebuilds that suffix from its own arguments, compares it to the end of `teeText`, and checks `teeSig` recovers to the registered `teeSigner`. Whether the signed text is exactly the response content must be confirmed in the first 0G test call.

**Inspector pipeline (server)**

1. Verify each manifest: P-256 signature against the registered device key, six angles present, capture time inside the rental window.
2. Prepare images: long side 1024 px, JPEG quality 80, metadata stripped, paired by angle.
3. Call the 0G Router once with all six pairs: static system rubric first, then the rental ID and the labelled pairs; `response_format: {"type":"json_object"}`, `temperature: 0`, `max_tokens: 700`, `verify_tee: true`. The vision model is chosen at startup from `/v1/models` entries whose input modalities include `image`.
4. Validate the JSON with zod. Retry once on a schema failure; a second failure goes to a human.
5. Apply rules: amount from the owner's schedule at the worst severity; confidence below 0.75, an unusable angle, or a capture above the cap goes to a human.
6. Encrypt photos with AES-256-GCM, upload photos and the inspection log to 0G Storage, keep the root hashes.
7. Propose the verdict onchain through the relayer.
8. If the Router fails or times out (30 seconds, two retries), stop: no verdict, state stays `Returned`, retry with backoff.

**Schemas**

- **Manifest:** `{v, rentalId, phase, role, deviceKeyId, capturedAt, appBuild, shots:[{angle, sha256, width, height}]}`, canonical JSON, signed with the Secure Enclave key. Its SHA-256 is the onchain manifest hash.
- **Model verdict:** `{rental_id, angles:[{angle, usable, new_damage, severity 0–3, location, description, confidence}], overall_confidence, text_in_image_ignored, eh}`.
- **Inspection log:** manifests, photo roots, model, provider, `request_id`, chat ID, `tee_verified`, prompt and rubric hashes, raw output, parsed verdict, rule version, schedule, decision, billing, timestamps.

**Server API**

| Method and path | Purpose |
| --- | --- |
| `POST /devices` | Register a device's P-256 public key for a party |
| `POST /rentals` | Owner creates a rental; returns the ID and pay link |
| `GET /rentals/:id` | State, terms, manifests, verdict, transaction links |
| `POST /rentals/:id/fund` | Renter's signed authorization; the relayer submits it |
| `POST /rentals/:id/scans/:phase` | Manifest, signature and six photos |
| `POST /rentals/:id/scans/:phase/confirm` | The other party's co-signature |
| `POST /rentals/:id/appeal` | Appeal inside the window (P1) |
| `GET /export.csv?owner=` | Settlements for an accountant (P1) |
| `GET /health/0g` | Router and Storage reachability, which drives the paused state |

**Relayer**

The relayer is a server wallet holding WBT. It only calls `EvenhandDeposits`, only the functions listed above, at most one funding call per rental, with a gas cap per transaction and rate limits per device. Operators prepay a fee balance in USDT that is debited per rental, which is how gas is paid for and why a stranger cannot drain the relayer.

## Security, privacy and threat model

The product is only worth something if neither side can steer the verdict, so most threats below are about evidence and authority rather than code bugs.

| Threat | Mitigation | Priority |
| --- | --- | --- |
| A party uploads old or edited photos | Camera-only capture, no photo library; each manifest signed by a Secure Enclave key with capture time; server rejects unsigned or stale manifests | P0 |
| Photos of a different item at return | The rental's QR tag must appear in every shot; the model is asked to confirm it is the same item | P1 |
| Genuine-looking photos from a modified app | Apple App Attest binds the signing key to the genuine app | P2 |
| Damage hidden by framing | Six fixed angles with on-screen guides; renter may add extra shots; an unusable angle routes to a human | P0 |
| Text in the image tells the model to ignore damage | Rubric says to ignore any text in images and report that it saw some; such cases go to a human | P0 |
| Model is wrong on a large charge | Automatic capture capped (for example 50% of the deposit); anything above goes to the arbiter; appeal window on every verdict | P0 cap, P1 appeal |
| Evenhand's inspector key is stolen | Key can only propose within the cap and the window; arbiter can pause; P1 adds the 0G provider's signature check so a stolen key alone cannot settle | P0, P1 |
| Renter signature front-run or replayed | `receiveWithAuthorization` only executes when called by the contract; random 32-byte nonces; short validity window | P0 |
| Relayer drained | Contract and function allowlist, one funding call per rental, gas cap, per-device rate limits, operator fee credit required, low-balance alert | P0 |
| Owner never returns a verdict | Full refund to the renter after the deadline plus grace, callable by anyone | P0 |
| 0G unreachable | Safe stop: no verdict is produced or guessed; deposit stays held; retries with backoff | P0 |

**Privacy**

- Photos may show faces, number plates or homes. They are encrypted with AES-256-GCM before upload to 0G Storage, and only hashes and storage roots go onchain.
- Inference runs in 0G's sealed mode. In this version the Evenhand server also sees the photos, because it prepares and forwards them. Sending photos from the phone straight to sealed inference is a later step, and the README must say so.
- No third-party analytics or trackers in the app or the web pages.

**Not handled in the hackathon build:** custody and licensing rules for holding deposits in each country, consumer-protection terms, and key recovery for renters who lose the browser key. The contract never sends funds anywhere except the owner and renter of a rental, but that is a design property, not a legal opinion.

## Sponsor fit and qualification checklist

Each item below is a requirement taken from the sponsor's Mumbai prize text or ETHGlobal's rules. Missing any one can disqualify the entry, so the build plan schedules them, not the last hour.

**0G: Physical AI, Agents with a Body** (first $2,500, second $1,500, best on real hardware $1,000; paid at 0G's discretion)

- [ ] A 0G call inside the decision loop: the vision model decides each inspection.
- [ ] An episode log on 0G Storage with a request ID per decision: the inspection log.
- [ ] A replayable run or a live hardware demo at the 0G booth: live iPhone demo plus the replay script (R16).
- [ ] A safe stop if 0G is unreachable that does not fake the decision: the paused state (R9).
- [ ] One sentence on what breaks without 0G: "Without a sealed, attested model, the verdict is the owner's word again."
- [ ] Public repo with README, demo video under 3 minutes, live link, contract addresses, Telegram and X contacts.
- [ ] Also submit to Build with 0G PC if 0G confirms one project may enter both.

**Whitechain: Operate, stablecoin payments for business** (first $2,500, second $1,500, third $1,000)

- [ ] Contracts deployed on Whitechain Sepolia (chain 1874) and verified on its explorer.
- [ ] At least one payment in the official test USDT in the main flow, with the explorer link in the README.
- [ ] A README line on why this needs onchain stablecoin settlement: "A contract that neither party controls holds the deposit, so a neutral verdict is binding on both; a card hold leaves the money with the merchant."
- [ ] A drop-in piece a separate demo app adds in about 20 lines: the SDK and demo shop (R13).
- [ ] Both views in the demo: owner and renter.
- [ ] Past the first payment: partial capture, refund and accountant export (R8, R14).
- [ ] Steady commit history, not one upload at the end.
- [ ] Demo video of 2 to 4 minutes showing each party.
- [ ] `WHITECHAIN_FEEDBACK.md` with honest notes on what worked and what the docs lacked.
- [ ] Avoid the "won't place" list: this must read as a merchant deposit product, not escrow on its own.

**Whitechain: Scale, payments nobody notices** (first $2,000, second $1,000) — only if the renter flow shows zero crypto steps

- [ ] Renter pays without holding WBT, writing down a seed phrase, or seeing a chain name.
- [ ] README explains how the business pays for gas, how the relayer gets WBT, and what stops it being drained.

**ETHGlobal rules**

- [ ] Submit on the "Finalist and Partner Prizes" path, choosing 0G and Whitechain as the partner prizes.
- [ ] No project-specific code, designs or assets from before kickoff.
- [ ] AI use documented down to files, with the PRD, build prompt and agent definitions committed under `docs/ai/`.
- [ ] Demo video narrated by a real voice, not sped up, not recorded on a phone; mirror the iPhone screen to a laptop and record there.

## Inference cost and token budget

One inspection should be one 0G call costing well under a cent, with a second call only when the first is unsure. The exact figure is unknown until the first test call, because 0G bills images as input tokens and does not publish how many tokens an image becomes.

**Rules for every inspection call**

1. **One batched request.** All six pairs go in one call, not twelve, so the rubric is sent once.
2. **Static prefix first.** The system rubric never changes between calls and comes first; the rental ID and images come after. If a provider caches prefixes, this is the shape that benefits; nothing depends on it.
3. **Small images.** Long side 1024 px, JPEG quality 80. Twelve such images are far below the 20 MB request cap.
4. **Short, structured output.** JSON mode, `temperature: 0`, `max_tokens: 700`, short descriptions (one line per angle).
5. **Escalate only on doubt.** First pass on the cheapest image model listed. If `overall_confidence` is below 0.75, one second pass on a stronger model. If it is still low, a human decides.
6. **Skip nothing that decides money.** No pre-filter replaces the 0G call: every verdict comes from 0G, which is what the Physical AI track requires.
7. **Measure and cap.** Record `x_0g_trace.billing` for every call in the log, and refuse any call whose estimated cost exceeds a per-inspection cap set in config.

**Price reference** from 0G's model list, per million tokens ([pc.0g.ai/models](https://pc.0g.ai/models)):

| Model | Input | Output | Role |
| --- | --- | --- | --- |
| Qwen3-Omni-Flash | $0.26 | $1.85 | First pass |
| Qwen3.5-Omni-Plus | $1.02 | $5.83 | Second pass on doubt |

Exact API model IDs are not shown on that page, so the server lists `/v1/models` at startup and picks image-capable models by name.

- [ ] In the first test call, record input tokens for twelve images and the cost from `x_0g_trace.billing`, then set the per-inspection cap from it.

## Build plan

The first six hours decide the weekend: by 06:00 Friday the two unknowns, the 0G call and the USDT authorization, must both work, or the plan changes before anything else is built. Submissions close at 09:00 IST on Saturday 7 November, so the plan below leaves an hour of margin.

| By (IST) | Milestone | Owner | Go or no-go test |
| --- | --- | --- | --- |
| Thu 23:59 | Repo scaffolded, `docs/interfaces.md` and shared schemas committed | Kunal | Every package builds |
| Fri 03:00 | 0G spike: one call with two images returns JSON, `request_id`, `tee_verified`; one 0G Storage upload returns a root | Kunal | All four values printed |
| Fri 03:00 | USDT spike: a `receiveWithAuthorization` deposit lands on Whitechain Sepolia | Solidity dev | Explorer link |
| Fri 03:00 | Capture spike: six photos and a Secure Enclave signature on a real iPhone | Swift dev | Server verifies the signature |
| Fri 10:00 | Contract complete with tests, deployed and verified | Solidity dev | All P0 transitions pass in Foundry |
| Fri 14:00 | Happy path end to end: deposit, pickup, return, verdict, settlement | All | Two USDT transfers from one real inspection |
| Fri 20:00 | Safe stop, timeout refund, waive, appeal, export, SDK and demo shop | All | Each exception shown once |
| Fri 23:00 | P1 stretch: TEE signature check, QR tag, replay script | Whoever is free | Each one done or dropped, no half-states |
| Sat 02:00 | Feature freeze; fresh-eyes review; README, feedback file, AI-use notes | Kunal | Checklist in the sponsor section all ticked |
| Sat 05:00 | Demo video recorded and edited; submission drafted | Kunal | Video 2–3 minutes, narrated |
| Sat 08:00 | Submitted, with an hour to spare | Kunal | Confirmation page saved |

**Who does what**

- **Solidity developer:** `contracts/`, the relayer's allowlist rules, deployment and verification, the Whitechain feedback file.
- **Swift developer:** `ios/`: guided capture, Secure Enclave signing, upload, owner and renter screens, verdict screen with request ID and transaction links.
- **Kunal:** `server/` (inspector, 0G clients, relayer), `web/` (pay page, dashboard, demo shop, SDK), integration, demo script, video, submission.

**If time runs short, cut in this order**

1. App Attest (R17) and iAI sign-in (R18).
2. The Scale track entry.
3. Replay script (R16), then the QR tag (R15).
4. The onchain TEE signature check (R12): keep the inspector key and say so in the README.
5. The SDK and demo shop (R13): show the pay page alone, and accept a weaker Operate entry.

Never cut safe stop, timeout refund or the inspection log: those are the 0G requirements and the reason the product can be trusted.

## Demo script and submission

The demo has one job: show a real scratch costing the renter exactly the schedule's amount, and a harmless smudge costing nothing, with proof on screen both times. Finalist judging allows 4 minutes of demo and 3 of questions.

**Live demo (4 minutes)**

| Time | What happens on stage | What the judges see |
| --- | --- | --- |
| 0:00 | "Rental customers were billed up to $960 for damage AI scanners said they found. The scanner belongs to the side that keeps the money." | Two headlines |
| 0:30 | Owner creates a rental; renter pays a $200 deposit on the second phone | "Pay deposit", no gas, no seed phrase; explorer link |
| 1:00 | Pickup scan of a laptop, six guided shots, renter confirms | Signed manifest hash onchain |
| 1:45 | A teammate scratches the vinyl skin on the lid; return scan | Return manifest onchain |
| 2:15 | Verdict: one angle marked "moderate", 35% kept | 0G request ID, `tee_verified`, storage root; two USDT transfers in one transaction |
| 3:00 | Second rental: laptop returned with only fingerprints on the screen | Full deposit back |
| 3:30 | Cut the 0G connection and run a third return | "Inspection paused"; deposit still held |
| 3:50 | "Neither side runs the inspector, and neither side holds the money." | Close |

Put a cheap vinyl skin on the demo laptop's lid so the scratch never touches the laptop itself, and use the same laptop for all three rentals. Run every step on testnet beforehand and keep a recorded fallback of each step on a second laptop in case the venue network fails.

**Likely questions, with answers ready**

- *Why would a rental company accept a verdict it does not control?* Because renters choose operators they trust, and because disputes cost the operator time; the operator also sets the damage schedule.
- *What if the model is wrong?* Confidence threshold, a cap on automatic charges, an appeal window, and a human arbiter.
- *Can someone fake the photos?* Camera-only capture signed by the phone's Secure Enclave; App Attest next.
- *Why onchain at all?* The deposit must be held by neither party for the verdict to bind both.
- *What does Evenhand's server still control?* It prepares the photos and holds the inspector key; the TEE signature check and phone-to-model upload remove that.

**Submission package**

- [ ] Public repo, open licence, README with setup, architecture diagram, contract addresses, explorer links, request IDs and storage roots from the demo run.
- [ ] Video of 2 to 3 minutes (fits both 0G's under-3 and Whitechain's 2-to-4 rules), narrated live, iPhone screen mirrored to the laptop.
- [ ] `WHITECHAIN_FEEDBACK.md`, `docs/ai/` with the PRD, build prompt and agent definitions, and a note on which files AI wrote.
- [ ] Live link to the pay page and the owner dashboard.
- [ ] Team names with Telegram and X handles.

## Risks and open questions

The biggest risk is not technical: 0G may decide that a phone inspecting an object is not "an agent with a body". Ask that first.

**Ask at the booths first thing Friday**

- [ ] **0G:** does a phone-based inspection with decisions at checkpoints qualify for Physical AI, and for the "real hardware" prize? If not, which 0G track does it fit?
- [ ] **0G:** may one project enter both Physical AI and the consumer-app track? The 0G sponsor page and the all-sponsors page list different tracks; which list is current?
- [ ] **0G:** with `verify_tee: true`, is the signed text exactly the response content, so a contract can check it? Does private mode also return a signature?
- [ ] **0G:** which image-capable model IDs do they recommend for comparing photos?
- [ ] **Whitechain:** does a deposit with partial capture and refund count as a merchant payment flow for Operate, rather than "escrow on its own"?
- [ ] **Whitechain:** what are the test USDT's decimals, and is there a rate limit on the faucet?

**Risks**

| Risk | Likelihood | Effect | Response |
| --- | --- | --- | --- |
| 0G rules the project out of Physical AI | Medium | Lose the main 0G prize route | Enter the consumer or Wildcard track if it exists; the product does not change |
| Vision model misses small damage on phone photos | High | Wrong verdicts in the demo | Demo with clearly visible damage; threshold and human review; show the paused and appealed paths as features |
| Contract-side TEE check not possible | Medium | Verdict rests on Evenhand's key | Keep P0 binding and state it in the README |
| Three integrations do not meet by Friday 14:00 | Medium | No end-to-end demo | Cut order in the build plan; spikes at 03:00 catch it early |
| Venue network fails during the demo | Medium | Live demo breaks | Recorded fallback of each step |
| Operators do not want a neutral inspector | Unknown | No business after the event | Ten operator conversations before building past the hackathon |
| Holding deposits is regulated in some countries | Unknown | Limits where it can launch | Legal advice before any mainnet launch |

## Sources

The Mumbai prize requirements are from the prize page Kunal attached. Everything else is from the pages below, opened on 5 November 2026.

**Problem**

- [Straight Arrow News: a congresswoman questions Hertz's AI damage scans](https://san.com/cc/how-do-hertzs-ai-damage-scans-work-a-congresswoman-wants-to-know/)
- [WebProNews: Hertz and Sixt AI scanners and phantom damage fees](https://www.webpronews.com/hertz-sixt-ai-scanners-trigger-phantom-damage-fee-disputes)
- [CarInsuRent 2025 rental claims data (National Law Review)](https://natlawreview.com/press-releases/2025-rental-car-claims-data-reveals-structural-risk-58-damage-claims-not)
- [Venable: stablecoins for merchants](https://www.venable.com/insights/publications/2026/03/stablecoins-an-emerging-consideration-for)

**0G**

- [0G Router quickstart](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/quickstart)
- [0G Router image inputs](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/image-inputs)
- [0G Router chat completions](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/chat-completions)
- [0G verifiable execution](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution)
- [0G Private Computer](https://pc.0g.ai) and [model prices](https://pc.0g.ai/models)
- [0G Storage SDK](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk)
- [0G testnet overview](https://docs.0g.ai/developer-hub/testnet/testnet-overview)

**Whitechain**

- [Whitechain docs index](https://docs.whitechain.io/llms-full.txt)
- [Test USDT implementation, verified source](https://explorer.testnet.whitechain.io/api/v2/smart-contracts/0x26425662D126412128967ECf0a02EC48573026F7)
- [Whitechain Builders Program](https://whitechain.io/builders)

**ETHGlobal**

- [ETHGlobal rules](https://ethglobal.com/rules)
- [Lisbon 2026 event details](https://ethglobal.com/events/lisbon2026/info/details)
