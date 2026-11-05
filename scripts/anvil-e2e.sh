#!/bin/sh
# Local integration (no testnet, no keys): the real EvenhandDeposits + a mock EIP-3009 USDT on anvil (chain id 1874),
# the real server chain code (sendTx, events, EIP-712 domain), scripted 0G and fake storage. Prints the final
# USDT balances: owner 70, renter 930 (of 1000), contract 0. Anvil's public dev keys only. Run: sh scripts/anvil-e2e.sh
set -e
export PATH="$HOME/.local/node-v22.23.4-darwin-arm64/bin:$HOME/.local/bin:$PATH:$HOME/.foundry/bin"
S=$(mktemp -d "${TMPDIR:-/tmp}/evenhand-anvil.XXXXXX")
REPO=$(cd "$(dirname "$0")/.." && pwd)
RPC=http://127.0.0.1:8546
K0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # deployer
K1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d # inspector
K2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a # relayer
K3=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 # arbiter
K4=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a # renter
K5=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba # owner
addr() { cast wallet address --private-key "$1"; }

anvil --chain-id 1874 --port 8546 --block-time 1 --silent > $S/anvil.log 2>&1 & echo $! > $S/anvil.pid
until cast chain-id --rpc-url $RPC >/dev/null 2>&1; do :; done
cd $REPO/contracts
USDT=$(forge create test/mocks/MockUSDT.sol:MockUSDT --rpc-url $RPC --private-key $K0 --broadcast 2>/dev/null | awk '/Deployed to:/ {print $3}')
D=$(forge create src/EvenhandDeposits.sol:EvenhandDeposits --rpc-url $RPC --private-key $K0 --broadcast \
  --constructor-args $USDT $(addr $K1) $(addr $K3) 20 3600 5000 7500 2>/dev/null | awk '/Deployed to:/ {print $3}')
cast send $USDT "mint(address,uint256)" $(addr $K4) 1000000000 --rpc-url $RPC --private-key $K0 >/dev/null
echo "USDT $USDT  DEPOSITS $D"

cd $REPO/server
rm -rf $S/anvil-sim
EVENHAND_SIM_CHAIN=real WC_RPC_URL=$RPC WC_CHAIN_ID=1874 USDT_ADDRESS=$USDT DEPOSITS_ADDRESS=$D \
  INSPECTOR_PRIVATE_KEY=$K1 RELAYER_PRIVATE_KEY=$K2 PORT=8797 DATA_DIR=$S/anvil-sim PUBLIC_BASE_URL=http://localhost:8797 \
  node --import tsx scripts/dev-fake.ts > $S/anvil-sim.log 2>&1 & echo $! > $S/anvil-sim.pid
curl -s --retry 20 --retry-delay 1 --retry-connrefused localhost:8797/health >/dev/null

E2E_BASE_URL=http://localhost:8797 TEST_RENTER_PRIVATE_KEY=$K4 E2E_OWNER_PRIVATE_KEY=$K5 E2E_DEPOSIT=200000000 \
  node --import tsx scripts/e2e-local.ts 2>&1 | grep -vE '^\s*"(front|back|left|right|detail):0",?$' | tail -22 || true

echo "--- waiting for the 20 s appeal window and the keeper's finalize"
for i in $(seq 1 12); do
  if grep -qE "^finalize 0x[0-9a-f]+: 0x" $S/anvil-sim.log; then break; fi
  sleep 5
done
grep -E "^finalize|not sent yet|paused" $S/anvil-sim.log | tail -3
echo "owner  USDT: $(cast call $USDT 'balanceOf(address)(uint256)' $(addr $K5) --rpc-url $RPC)"
echo "renter USDT: $(cast call $USDT 'balanceOf(address)(uint256)' $(addr $K4) --rpc-url $RPC)"
echo "contract   : $(cast call $USDT 'balanceOf(address)(uint256)' $D --rpc-url $RPC)"
kill $(cat $S/anvil-sim.pid) $(cat $S/anvil.pid)
rm -rf "$S"
