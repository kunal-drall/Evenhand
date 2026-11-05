# contracts

`EvenhandDeposits` holds a rental's USDT deposit on Whitechain Sepolia (chain 1874) and settles it by the inspection verdict. Spec: `docs/interfaces.md` section 3.

```sh
forge soldeer install          # forge-std 1.17.0, OpenZeppelin 5.7.0 into dependencies/
forge build
forge test --match-contract <Name> -q
```

On an exFAT/FAT drive, run `sh ../scripts/clean-appledouble.sh` first: forge fails on macOS `._*` files.
