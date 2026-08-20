/**
 * Shared Hedera helpers: operator accounts, key parsing and address resolution.
 *
 * Address resolution matters more than it looks. A Hedera account has up to two
 * EVM addresses:
 *
 *   - the "long zero" address, the account number padded to 20 bytes
 *     (0.0.10116894 -> 0x00000000000000000000000000000000009a5f1e)
 *   - the EVM alias, derived from the ECDSA public key
 *     (0x4844b215fead62d66f2855ff0a81068662ec1b00)
 *
 * For an ECDSA account that has an alias, `msg.sender` inside the contract is the
 * alias, not the long zero address. Putting the wrong form on the not-allowed list
 * means the check silently never fires, so resolveAccountAddresses() returns both
 * forms and the list is filled with both.
 */

import "dotenv/config";
import { AccountId, Client, Hbar, PrivateKey, TransactionRecordQuery } from "@hashgraph/sdk";

const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

/** Parse a private key that may be DER encoded or a raw ECDSA / ED25519 hex string. */
function parsePrivateKey(raw) {
  const value = raw.trim();
  for (const parse of [PrivateKey.fromStringDer, PrivateKey.fromStringECDSA, PrivateKey.fromStringED25519]) {
    try {
      return parse(value);
    } catch {
      // try the next encoding
    }
  }
  throw new Error("Could not parse the private key. Expected a DER or raw ECDSA / ED25519 hex key.");
}

/**
 * A Testnet client operated by account `slot` from .env.
 *
 * Slot 1 uses HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY, every further slot uses a
 * numeric suffix: HEDERA_OPERATOR_ID_2 / HEDERA_OPERATOR_KEY_2, and so on.
 */
export function makeTestnetClient(slot = 1) {
  const suffix = slot === 1 ? "" : `_${slot}`;
  const id = process.env[`HEDERA_OPERATOR_ID${suffix}`];
  const key = process.env[`HEDERA_OPERATOR_KEY${suffix}`];

  if (!id || !key) {
    throw new Error(
      `Account ${slot} is not configured. Set HEDERA_OPERATOR_ID${suffix} and ` +
        `HEDERA_OPERATOR_KEY${suffix} in your .env file.`
    );
  }

  const accountId = AccountId.fromString(id.trim());
  const client = Client.forTestnet();
  client.setOperator(accountId, parsePrivateKey(key));
  // cap accidental fee spend
  client.setDefaultMaxTransactionFee(new Hbar(20));
  client.setDefaultMaxQueryPayment(new Hbar(2));

  return { client, accountId };
}

/**
 * Every EVM address a value can appear as inside a contract.
 *
 * A 0x address resolves to itself. A 0.0.x account id resolves to its EVM alias
 * (when it has one) plus its long zero address, so a check against msg.sender
 * matches whichever form Hedera uses for that account.
 */
export async function resolveAccountAddresses(value) {
  const input = value.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return [input.toLowerCase()];

  const longZero = ("0x" + AccountId.fromString(input).toSolidityAddress()).toLowerCase();

  try {
    const response = await fetch(`${MIRROR_NODE}/api/v1/accounts/${input}`);
    const alias = response.ok ? (await response.json()).evm_address : null;

    // the mirror node returns the long zero form when there is no real alias
    if (alias && alias.toLowerCase() !== longZero) return [alias.toLowerCase(), longZero];
  } catch {
    // mirror node unreachable, fall back to the long zero address alone
  }
  return [longZero];
}

/**
 * Execute a transaction and, when it reverts, attach the raw revert data.
 *
 * A failing receipt only reports CONTRACT_REVERT_EXECUTED. The revert data that
 * identifies the custom error lives in the transaction record, which has to be
 * fetched with receipt validation switched off.
 */
export async function executeTransaction(client, transaction) {
  const response = await transaction.execute(client);

  try {
    const receipt = await response.getReceipt(client);
    return { status: receipt.status.toString(), response };
  } catch (err) {
    try {
      const record = await new TransactionRecordQuery()
        .setTransactionId(response.transactionId)
        .setValidateReceiptStatus(false)
        .execute(client);
      err.revertData = record.contractFunctionResult?.errorMessage ?? null;
    } catch {
      // the record is not available, keep the original error as is
    }
    throw err;
  }
}
