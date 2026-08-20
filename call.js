/**
 * TEMPLATE: Call a method on a smart contract deployed on the Hedera Testnet.
 *
 * This is intentionally left as a starting point. To use it you only need to
 * adjust the CONFIG block below:
 *   1. CONTRACT_ID  – the contract to call
 *   2. MODE         – "query" for view/pure functions, "execute" for state-changing ones
 *   3. METHOD_NAME  – the Solidity function name
 *   4. buildParams  – add the call arguments in order (or leave empty)
 *   5. RETURN_TYPE  – the single return type to decode (multiple returns are NOT supported)
 *
 * The script prints the decoded return value, its type, and the call status.
 *
 * Usage:
 *   node call.js
 *
 * Requires a .env file (see .env.example) with HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY.
 */

import "dotenv/config";
import {
  Client,
  PrivateKey,
  AccountId,
  ContractId,
  ContractExecuteTransaction,
  ContractCallQuery,
  ContractFunctionParameters,
  Hbar,
} from "@hashgraph/sdk";

/* ================================================================== */
/* CONFIG – fill these in                                              */
/* ================================================================== */

// 1. The contract you want to call (e.g. "0.0.1234567").
const CONTRACT_ID = "0.0.10149341"; // TODO

// 2. "query"   -> read-only view/pure function (free, no state change)
//    "execute" -> state-changing function (costs gas, produces a receipt status)
const MODE = "query"; // We use "query" because we are just reading data

// 3. Name of the Solidity function to call.
const METHOD_NAME = "getTopicVotes";

// 4. Gas limit (needed for both a query result and an execute transaction).
const GAS = 100_000; 

// 5. The single return type to decode. Set to null if the method returns nothing.
const RETURN_TYPE = "uint256"; // getTopicVotes returns a uint256 number

/**
 * 6. Build the call arguments here, in the order the Solidity function expects.
 */
function buildParams() {
  const params = new ContractFunctionParameters();
  // Grab the first argument from the command line, defaulting to 0 if none provided
  const topicIndex = process.argv[2] ? parseInt(process.argv[2], 10) : 0;
  params.addUint256(topicIndex);
  return params;
}

/* ================================================================== */
/* Below this line is the reusable machinery — no changes needed       */
/* ================================================================== */

/** Decode a single return value from the ContractFunctionResult by type. */
function decodeReturn(result, type) {
  if (type === null || type === undefined) return { value: undefined, type: "void" };

  const decoders = {
    string: (r) => r.getString(0),
    bool: (r) => r.getBool(0),
    address: (r) => "0x" + r.getAddress(0),
    uint256: (r) => r.getUint256(0).toString(),
    int256: (r) => r.getInt256(0).toString(),
    uint64: (r) => r.getUint64(0).toString(),
    int64: (r) => r.getInt64(0).toString(),
    uint32: (r) => r.getUint32(0),
    int32: (r) => r.getInt32(0),
    bytes: (r) => "0x" + Buffer.from(r.getBytes(0)).toString("hex"),
    bytes32: (r) => "0x" + Buffer.from(r.getBytes32(0)).toString("hex"),
  };

  const decoder = decoders[type];
  if (!decoder) {
    throw new Error(
      `Unsupported RETURN_TYPE "${type}". Supported: ${Object.keys(decoders).join(", ")}.`
    );
  }
  return { value: decoder(result), type };
}

/** Parse a private key that may be DER-encoded or a raw ECDSA/ED25519 hex string. */
function parsePrivateKey(raw) {
  try {
    return PrivateKey.fromStringDer(raw);
  } catch {
    return PrivateKey.fromStringECDSA(raw);
  }
}

function makeTestnetClient() {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKeyRaw = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKeyRaw) {
    throw new Error(
      "Please set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in your environment (.env)."
    );
  }
  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(operatorId), parsePrivateKey(operatorKeyRaw));
  client.setDefaultMaxTransactionFee(new Hbar(20));
  return client;
}

async function main() {
  const client = makeTestnetClient();
  const contractId = ContractId.fromString(CONTRACT_ID);
  const params = buildParams();

  console.log(`Calling ${METHOD_NAME}() on ${CONTRACT_ID} (mode: ${MODE}) ...\n`);

  let returnValue;
  let status;

  if (MODE === "query") {
    // Read-only call: no consensus transaction, so there is no receipt.
    // "Status" is SUCCESS if the query executes without error.
    const query = new ContractCallQuery()
      .setContractId(contractId)
      .setGas(GAS)
      .setFunction(METHOD_NAME, params);

    const result = await query.execute(client);
    returnValue = decodeReturn(result, RETURN_TYPE);
    status = "SUCCESS";
  } else if (MODE === "execute") {
    // State-changing call: submitted as a transaction with a receipt status.
    const tx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(GAS)
      .setFunction(METHOD_NAME, params);

    const txResponse = await tx.execute(client);
    const receipt = await txResponse.getReceipt(client);
    status = receipt.status.toString();

    // The return value of a state-changing call lives in the transaction record.
    const record = await txResponse.getRecord(client);
    returnValue = record.contractFunctionResult
      ? decodeReturn(record.contractFunctionResult, RETURN_TYPE)
      : { value: undefined, type: "void" };
  } else {
    throw new Error(`Unknown MODE "${MODE}". Use "query" or "execute".`);
  }

  console.log("Result");
  console.log(`  Return value : ${returnValue.value}`);
  console.log(`  Return type  : ${returnValue.type}`);
  console.log(`  Call status  : ${status}`);

  client.close();
}

main().catch((err) => {
  console.error("\n❌ Call error:", err.message ?? err);
  process.exit(1);
});
