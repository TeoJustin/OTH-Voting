# OTH Summer School: Voting on Hedera

A voting smart contract in Solidity, deployed to the **Hedera Testnet** with the
official [`@hashgraph/sdk`](https://www.npmjs.com/package/@hashgraph/sdk) and called
from **several accounts**.

| Requirement | Where |
|---|---|
| Create a smart contract | [`Voting.sol`](Voting.sol) |
| Deploy it to a ledger | [`deploy.js`](deploy.js), Hedera Testnet |
| Call functions with multiple accounts | [`call.js --as N`](call.js) |
| Topics defined by the constructor | `constructor(string[] topicNames, address[] notAllowedAccounts)` |
| Everybody votes exactly once | `hasVoted` mapping, checked in `vote()` |
| The result can be printed | `getResults()`, `getWinner()` |
| Accounts that are not allowed to vote | `notAllowedToVote` mapping, filled by the constructor |
| The contract must be secure | see [Security notes](#security-notes) |

## Files

| File | Purpose |
|---|---|
| `Voting.sol` | The contract |
| `Voting.json` | ABI and bytecode, exported from the Solidity compiler |
| `deploy.js` | Deploys the contract with its constructor arguments |
| `call.js` | Calls any method, from any configured account |
| `hedera.js` | Shared client, key parsing and address resolution |
| `deployment.json` | Written by `deploy.js`, holds the current contract id |

## 1. Setup

```bash
npm install
```

Copy `.env.example` to `.env` and fill in **two** Testnet accounts from the
[Hedera Portal](https://portal.hedera.com/). Account 1 deploys the contract and
becomes its owner, account 2 proves that a second identity behaves differently:

```
HEDERA_OPERATOR_ID=0.0.xxxxx
HEDERA_OPERATOR_KEY=302e0201...

HEDERA_OPERATOR_ID_2=0.0.yyyyy
HEDERA_OPERATOR_KEY_2=302e0201...
```

## 2. Compile

`Voting.json` is already in the repo. Recompile only after changing `Voting.sol`:

1. Open `Voting.sol` in [Remix](https://remix.ethereum.org/)
2. Select compiler **0.8.24** (the pragma pins it) and enable the optimizer
3. Copy the **ABI** and the **bytecode object** into `Voting.json`

`deploy.js` also reads Remix's full "Compilation Artifact" export unchanged, if you
prefer to drop that file in place instead.

## 3. Deploy

```bash
node deploy.js --arg-string-array "Pizza,Pasta,Salad" --arg-address-array "0.0.yyyyy"
```

The first array is the voting topics, the second is the accounts that are **not**
allowed to vote (pass `""` for none). The contract id is written to
`deployment.json`, so `call.js` picks it up automatically.

## 4. Call methods

```bash
node call.js <method> [args...] [--as N] [--contract 0.0.x]
```

`call.js` reads the ABI, so it knows the argument types, runs `view`/`pure`
functions as free queries and everything else as transactions, and decodes any
return shape. Addresses accept `0.0.x` or `0x...`. Reverts are decoded into the
custom error that caused them:

```
Call error: reverted with AlreadyVoted(0x7BD5e03f8655606f918Bdf66259058245dA861EA)
```

`--as N` selects the operator account from `.env`, defaulting to 1.

## 5. The full walkthrough

Run against a freshly deployed contract, in this order. Each account may vote only
once and `closeVoting` is permanent, so the sequence works exactly once per
contract. Steps 4, 5 and 6 are *supposed* to fail: the revert is the proof that the
rule is enforced, and `call.js` exits with code 1 on each of them.

```bash
node call.js getResults                        # 1. topics from the constructor, all at 0
node call.js notAllowedToVote 0.0.<account2>   # 2. true, set at deployment
node call.js vote 0                            # 3. account 1 votes -> SUCCESS
node call.js vote 2                            # 4. same account again -> AlreadyVoted
node call.js vote 1 --as 2                     # 5. blocked account -> NotAllowed
node call.js setVotingAllowed 0.0.<account2> true --as 2   # 6. not the owner -> NotOwner
node call.js setVotingAllowed 0.0.<account2> true          # 7. owner -> SUCCESS
node call.js vote 1 --as 2                     # 8. now allowed -> SUCCESS
node call.js getResults                        # 9. [1, 1, 0]
node call.js getWinner                         # 10. Pizza, tied
node call.js closeVoting                       # 11. owner closes the voting
node call.js canVote 0.0.<account1>            # 12. false, the result stays readable
```

Step 5 is the important one, see [Account addresses](#account-addresses).

`getWinner` reporting `tied: true` at step 10 is correct: Pizza and Pasta both hold
one vote, so the contract reports the lowest-index leader and flags the draw. Have
both accounts vote for the same topic if you want an outright winner.

## Contract API

| Function | Kind | Description |
|---|---|---|
| `vote(uint256 topicIndex)` | write | Cast the caller's single vote |
| `canVote(address)` | view | Whether that account could still vote |
| `getResults()` | view | All topic names and all vote counts |
| `getWinner()` | view | Leading topic, plus whether it is tied |
| `totalVotes()` | view | Votes cast so far |
| `hasVoted(address)` | view | Whether that account already voted |
| `notAllowedToVote(address)` | view | Whether that account is blocked |
| `votingClosed()` | view | Whether voting is closed |
| `owner()` | view | The deployer |
| `setVotingAllowed(address, bool)` | write, owner | Change the not-allowed list |
| `closeVoting()` | write, owner | Stop accepting votes |

## Account addresses

A Hedera account has up to two EVM addresses:

- the **long zero** address, the account number padded to 20 bytes
  (`0.0.10116894` becomes `0x00000000000000000000000000000000009a5f1e`)
- the **EVM alias**, derived from the ECDSA public key
  (`0x4844b215fead62d66f2855ff0a81068662ec1b00`)

For an ECDSA account that has an alias, `msg.sender` inside the contract is the
**alias**, not the long zero address. Putting the wrong form on the not-allowed list
means the check silently never fires and a blocked account votes anyway.

`hedera.js` handles this: a `0.0.x` id given to `--arg-address-array` is expanded to
both forms via the mirror node, so the check matches whichever address Hedera uses.

## Security notes

- **Pinned compiler.** `pragma solidity 0.8.24` instead of a floating `^0.8.0`, so
  the deployed bytecode always comes from a known compiler.
- **One vote per account.** `hasVoted[msg.sender]` is set *before* the counter is
  touched, so no path can count a vote twice.
- **Checks before effects.** `vote()` validates the topic index, the not-allowed
  list and the previous vote before writing any state.
- **No external calls.** Nothing in the contract calls out, so reentrancy has no
  entry point.
- **Immutable owner.** `address public immutable owner` is set once at construction.
  There is no `transferOwnership` and no `selfdestruct`.
- **Owner has no vote privileges.** `setVotingAllowed` and `closeVoting` are
  owner-only, but the owner votes under the same rules as everybody else and cannot
  change a vote that was already cast.
- **Typed custom errors.** Every rejection names the offending account or index,
  which is cheaper than string reverts and easier to debug.
- **Results stay readable.** Closing the voting only blocks `vote()`, the getters
  keep working.
