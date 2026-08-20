/**
 * Call a method on the deployed Voting contract, from any configured account.
 *
 * The ABI drives everything: the argument types, whether the call is a free query
 * or a paid transaction, and how the return value is decoded.
 *
 * Usage:
 *   node call.js <method> [args...] [--as N] [--contract 0.0.x]
 *
 * Examples:
 *   node call.js getResults
 *   node call.js vote 1 --as 2
 *   node call.js setVotingAllowed 0.0.10116894 true
 */

import fs from "node:fs";
import { ethers } from "ethers";
import { ContractCallQuery, ContractExecuteTransaction, ContractId } from "@hashgraph/sdk";
import { executeTransaction, makeTestnetClient, resolveAccountAddresses } from "./hedera.js";

const ABI_FILE = "Voting.json";
const DEPLOYMENT_FILE = "deployment.json";
const GAS = 300_000;

function parseArgs(argv) {
  const opts = { method: null, args: [], slot: 1, contractId: null };

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--as") opts.slot = Number(argv[++i]);
    else if (token === "--contract") opts.contractId = argv[++i];
    else if (token.startsWith("--")) throw new Error(`Unknown option: ${token}`);
    else if (opts.method === null) opts.method = token;
    else opts.args.push(token);
  }

  if (!opts.method) throw new Error("Usage: node call.js <method> [args...] [--as N] [--contract 0.0.x]");
  if (!Number.isInteger(opts.slot) || opts.slot < 1) throw new Error("--as expects an account slot number.");

  if (!opts.contractId) {
    if (!fs.existsSync(DEPLOYMENT_FILE)) {
      throw new Error(`No ${DEPLOYMENT_FILE}. Deploy first, or pass --contract 0.0.x.`);
    }
    opts.contractId = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8")).contractId;
  }
  return opts;
}

/** Turn a CLI string into a value the ABI coder accepts. */
async function coerce(type, raw) {
  // accepts 0.0.x as well, resolved to the address msg.sender would carry
  if (type === "address") return (await resolveAccountAddresses(raw))[0];
  if (type === "bool") return raw.trim().toLowerCase() === "true";
  if (/^u?int\d*$/.test(type)) return BigInt(raw.trim());
  return raw;
}

/** Render a decoded value so bigints and arrays print readably. */
function render(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map(render).join(", ")}]`;
  return String(value);
}

/** Pull the custom error out of a Hedera revert, so the reason is readable. */
function explainError(err, iface) {
  const message = err.message ?? String(err);

  for (const data of [err.revertData, message.match(/0x[0-9a-fA-F]{8,}/)?.[0]]) {
    try {
      const parsed = data ? iface.parseError(data) : null;
      if (parsed) return `reverted with ${parsed.name}(${parsed.args.map(render).join(", ")})`;
    } catch {
      // not a decodable custom error, try the next candidate
    }
  }
  return message;
}

async function main() {
  const opts = parseArgs(process.argv);
  const iface = new ethers.Interface(JSON.parse(fs.readFileSync(ABI_FILE, "utf8")).abi);

  const fragment = iface.getFunction(opts.method);
  if (!fragment) {
    const names = iface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    throw new Error(`Method "${opts.method}" is not in the ABI. Available: ${names.join(", ")}`);
  }
  if (fragment.inputs.length !== opts.args.length) {
    const signature = fragment.inputs.map((i) => `${i.type} ${i.name}`).join(", ") || "none";
    throw new Error(`Method expects ${fragment.inputs.length} argument(s) (${signature}), got ${opts.args.length}.`);
  }

  const values = await Promise.all(fragment.inputs.map((input, i) => coerce(input.type, opts.args[i])));
  const callData = Buffer.from(iface.encodeFunctionData(fragment, values).slice(2), "hex");

  // view and pure functions are free queries, everything else costs gas
  const isQuery = fragment.stateMutability === "view" || fragment.stateMutability === "pure";
  const { client, accountId } = makeTestnetClient(opts.slot);

  console.log(`Calling ${fragment.format("sighash")} on ${opts.contractId}`);
  console.log(`  as account : ${accountId.toString()} (slot ${opts.slot})`);
  console.log(`  mode       : ${isQuery ? "query" : "execute"}`);
  if (values.length > 0) console.log(`  arguments  : ${values.map(render).join(", ")}`);
  console.log("");

  try {
    const contractId = ContractId.fromString(opts.contractId);
    let resultBytes;
    let status;

    if (isQuery) {
      const result = await new ContractCallQuery()
        .setContractId(contractId)
        .setGas(GAS)
        .setFunctionParameters(callData)
        .execute(client);

      resultBytes = result.asBytes();
      status = "SUCCESS";
    } else {
      const transaction = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(GAS)
        .setFunctionParameters(callData);

      const executed = await executeTransaction(client, transaction);
      status = executed.status;
      console.log(`  transaction : ${executed.response.transactionId.toString()}`);
      resultBytes = null;
    }

    console.log("Result");
    if (resultBytes?.length > 0 && fragment.outputs.length > 0) {
      const decoded = iface.decodeFunctionResult(fragment, "0x" + Buffer.from(resultBytes).toString("hex"));
      fragment.outputs.forEach((output, i) => {
        const label = output.name ? `${output.name} (${output.type})` : output.type;
        console.log(`  ${label.padEnd(28)} ${render(decoded[i])}`);
      });
    } else {
      console.log("  (no return value)");
    }
    console.log(`  status${" ".repeat(22)} ${status}`);
  } catch (err) {
    throw new Error(explainError(err, iface));
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("\nCall error:", err.message ?? err);
  process.exit(1);
});
