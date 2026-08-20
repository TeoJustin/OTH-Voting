/**
 * Deploy the compiled Voting contract to the Hedera Testnet.
 *
 * Usage:
 *   node deploy.js [artifact] --arg-string-array "A,B,C" --arg-address-array "0.0.x,0.0.y"
 *
 * Example:
 *   node deploy.js Voting.json \
 *     --arg-string-array "Pizza,Pasta,Salad" \
 *     --arg-address-array "0.0.10116894"
 *
 * The contract id is written to deployment.json, so call.js finds it automatically.
 * Requires a .env file (see .env.example).
 */

import fs from "node:fs";
import { ContractCreateFlow, ContractFunctionParameters } from "@hashgraph/sdk";
import { makeTestnetClient, resolveAccountAddresses } from "./hedera.js";

const DEFAULT_ARTIFACT = "Voting.json";
const DEPLOYMENT_FILE = "deployment.json";
const GAS = 1_500_000;

/** Split a comma separated list, treating "" as an empty list. */
const splitList = (raw) => raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

function parseArgs(argv) {
  const opts = { artifact: DEFAULT_ARTIFACT, topics: null, notAllowed: null };

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--arg-string-array") opts.topics = splitList(argv[++i] ?? "");
    else if (token === "--arg-address-array") opts.notAllowed = splitList(argv[++i] ?? "");
    else if (!token.startsWith("--")) opts.artifact = token;
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (opts.topics === null || opts.notAllowed === null) {
    throw new Error(
      'Both constructor arguments are required. Use --arg-string-array "A,B,C" and ' +
        '--arg-address-array "0.0.x" (pass "" for no blocked accounts).'
    );
  }
  if (opts.topics.length === 0) throw new Error("At least one topic is required.");
  return opts;
}

/**
 * Read the creation bytecode from the artifact.
 *
 * Accepts the compact form committed here ({ abi, bytecode }) and the full
 * artifact Remix exports ({ data: { bytecode: { object } } }). The runtime
 * bytecode is never used as a fallback: deploying it produces a contract that
 * reverts on every call.
 */
function loadBytecode(artifact) {
  const candidate = artifact.bytecode ?? artifact.data?.bytecode?.object;
  const hex = (typeof candidate === "string" ? candidate : candidate?.object) ?? "";
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (!/^[0-9a-fA-F]+$/.test(stripped) || stripped.length === 0) {
    throw new Error("No valid creation bytecode in the artifact. Did the contract compile?");
  }
  return stripped;
}

async function main() {
  const opts = parseArgs(process.argv);
  const artifact = JSON.parse(fs.readFileSync(opts.artifact, "utf8"));
  const bytecode = loadBytecode(artifact);

  // an account id expands to every EVM address it can appear as, so the check
  // against msg.sender matches whichever form Hedera uses for that account
  const addresses = [];
  for (const entry of opts.notAllowed) {
    addresses.push(...(await resolveAccountAddresses(entry)));
  }
  const notAllowed = [...new Set(addresses)];

  const { client, accountId } = makeTestnetClient(1);

  console.log("Deploying Voting to Hedera Testnet ...");
  console.log(`  operator    : ${accountId.toString()}`);
  console.log(`  topics      : ${JSON.stringify(opts.topics)}`);
  console.log(`  not allowed : ${JSON.stringify(notAllowed)}`);

  try {
    // ContractCreateFlow uploads the bytecode to a file and creates the contract
    // in one step, chunking automatically for large contracts
    const response = await new ContractCreateFlow()
      .setGas(GAS)
      .setBytecode(bytecode)
      .setConstructorParameters(
        new ContractFunctionParameters().addStringArray(opts.topics).addAddressArray(notAllowed)
      )
      .execute(client);

    const contractId = (await response.getReceipt(client)).contractId;
    if (!contractId) throw new Error("Deployment failed, no contract id in the receipt.");

    fs.writeFileSync(
      DEPLOYMENT_FILE,
      JSON.stringify(
        {
          contractId: contractId.toString(),
          deployedBy: accountId.toString(),
          deployedAt: new Date().toISOString(),
          topics: opts.topics,
          notAllowed,
        },
        null,
        2
      )
    );

    console.log("\nContract deployed successfully");
    console.log(`  Contract ID : ${contractId.toString()}`);
    console.log(`  HashScan    : https://hashscan.io/testnet/contract/${contractId.toString()}`);
    console.log(`  Saved to    : ${DEPLOYMENT_FILE}`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("\nDeployment error:", err.message ?? err);
  process.exit(1);
});
