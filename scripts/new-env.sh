#!/bin/sh
# Step 0 helper: creates .env (gitignored) from .env.example with fresh keys for every role, a random operator
# token and photo key. Never overwrites an existing .env. Prints addresses only (to fund), never private keys.
# You still add ZG_API_KEY (0G Router, sk-...) yourself, and fund the addresses printed below.
set -e
export PATH="$HOME/.foundry/bin:$PATH"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV="$ROOT/.env"
[ -e "$ENV" ] && { echo ".env already exists; not touching it"; exit 1; }
umask 077

# 32 random bytes is a valid secp256k1 key with overwhelming probability. Nothing secret is ever echoed.
newkey() { echo "0x$(openssl rand -hex 32)"; }
addr() { cast wallet address --private-key "$1" 2>/dev/null; }
DEPLOYER=$(newkey); INSPECTOR=$(newkey); RELAYER=$(newkey); ARBITER=$(newkey)
RENTER=$(newkey); OWNER=$(newkey); STORAGE=$(newkey)
for k in "$DEPLOYER" "$INSPECTOR" "$RELAYER" "$ARBITER" "$RENTER" "$OWNER" "$STORAGE"; do
  echo "$k" | grep -Eq '^0x[0-9a-f]{64}$' || { echo "key generation failed; nothing written"; exit 1; }
  addr "$k" | grep -Eq '^0x[0-9a-fA-F]{40}$' || { echo "address derivation failed; nothing written"; exit 1; }
done

sed -e "s#^ZG_STORAGE_PRIVATE_KEY=.*#ZG_STORAGE_PRIVATE_KEY=$STORAGE#" \
    -e "s#^INSPECTOR_PRIVATE_KEY=.*#INSPECTOR_PRIVATE_KEY=$INSPECTOR#" \
    -e "s#^RELAYER_PRIVATE_KEY=.*#RELAYER_PRIVATE_KEY=$RELAYER#" \
    -e "s#^ARBITER_ADDRESS=.*#ARBITER_ADDRESS=$(addr "$ARBITER")#" \
    -e "s#^TEST_RENTER_PRIVATE_KEY=.*#TEST_RENTER_PRIVATE_KEY=$RENTER#" \
    -e "s#^E2E_OWNER_PRIVATE_KEY=.*#E2E_OWNER_PRIVATE_KEY=$OWNER#" \
    -e "s#^DEPLOYER_PRIVATE_KEY=.*#DEPLOYER_PRIVATE_KEY=$DEPLOYER#" \
    -e "s#^PHOTO_ENCRYPTION_KEY=.*#PHOTO_ENCRYPTION_KEY=$(openssl rand -hex 32)#" \
    -e "s#^OPERATOR_TOKEN=.*#OPERATOR_TOKEN=$(openssl rand -hex 16)#" \
    "$ROOT/.env.example" > "$ENV"
printf '%s\n' "" "# arbiter wallet: import this key into the arbiter's browser wallet for /arbiter (not used by the server)" "ARBITER_PRIVATE_KEY=$ARBITER" >> "$ENV"

echo "wrote .env (mode 600). Fund these addresses:"
echo "  WBT (https://faucet.testnet.whitechain.io):"
echo "    deployer   $(addr "$DEPLOYER")"
echo "    inspector  $(addr "$INSPECTOR")"
echo "    relayer    $(addr "$RELAYER")"
echo "    arbiter    $(addr "$ARBITER")   (only to resolve appeals from /arbiter)"
echo "  test USDT 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 (ask the Whitechain booth):"
echo "    renter     $(addr "$RENTER")"
echo "  0G Galileo tokens (https://faucet.0g.ai):"
echo "    storage    $(addr "$STORAGE")"
echo "  owner payout (no funds needed): $(addr "$OWNER")"
echo "Then add ZG_API_KEY=sk-... to .env and run: pnpm -C server preflight"
