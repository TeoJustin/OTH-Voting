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
import "dotenv/config";
import { AccountId, Client, ContractCreateFlow, ContractFunctionParameters, Hbar, PrivateKey } from "@hashgraph/sdk";

const ARTIFACT = "Voting.json";
const DEPLOYMENT_FILE = "deployment.json";
const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";
const GAS = 1_500_000;

const splitList = (raw) => raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

function parseArgs(argv) {
  const opts = { artifact: ARTIFACT, topics: null, notAllowed: null };

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

/** Read the creation bytecode from the artifact ({ abi, bytecode } or Remix's full export). */
function loadBytecode(artifact) {
  const candidate = artifact.bytecode ?? artifact.data?.bytecode?.object;
  const hex = (typeof candidate === "string" ? candidate : candidate?.object) ?? "";
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (!/^[0-9a-fA-F]+$/.test(stripped) || stripped.length === 0) {
    throw new Error("No valid creation bytecode in the artifact. Did the contract compile?");
  }
  return stripped;
}

/** DER, ECDSA hex, or ED25519 hex private key. */
function parseKey(raw) {
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

function makeClient() {
  const id = process.env.HEDERA_OPERATOR_ID;
  const key = process.env.HEDERA_OPERATOR_KEY;
  if (!id || !key) throw new Error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in your .env file.");

  const accountId = AccountId.fromString(id.trim());
  const client = Client.forTestnet();
  client.setOperator(accountId, parseKey(key));
  client.setDefaultMaxTransactionFee(new Hbar(20));
  return { client, accountId };
}

/**
 * An account id can appear on-chain as two EVM addresses: the "long zero" form
 * (account number padded to 20 bytes) and, for ECDSA accounts, an alias derived
 * from the public key. msg.sender may be either, so resolve both.
 */
async function resolveAddress(value) {
  const input = value.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return [input.toLowerCase()];

  const longZero = ("0x" + AccountId.fromString(input).toSolidityAddress()).toLowerCase();
  try {
    const response = await fetch(`${MIRROR_NODE}/api/v1/accounts/${input}`);
    const alias = response.ok ? (await response.json()).evm_address : null;
    if (alias && alias.toLowerCase() !== longZero) return [alias.toLowerCase(), longZero];
  } catch {
    // mirror node unreachable, fall back to the long zero address alone
  }
  return [longZero];
}

async function main() {
  const opts = parseArgs(process.argv);
  const artifact = JSON.parse(fs.readFileSync(opts.artifact, "utf8"));
  const bytecode = loadBytecode(artifact);

  const addresses = [];
  for (const entry of opts.notAllowed) addresses.push(...(await resolveAddress(entry)));
  const notAllowed = [...new Set(addresses)];

  const { client, accountId } = makeClient();

  console.log("Deploying Voting to Hedera Testnet ...");
  console.log(`  operator    : ${accountId.toString()}`);
  console.log(`  topics      : ${JSON.stringify(opts.topics)}`);
  console.log(`  not allowed : ${JSON.stringify(notAllowed)}`);

  try {
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
