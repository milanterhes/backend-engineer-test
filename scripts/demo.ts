import { createHash } from "crypto";
import { getDb, initializeDb } from "../src/db";
import { utxos } from "../src/db/schema";
import type { Block, Transaction } from "../src/types/block.types";

const API_BASE_URL = "http://localhost:3000";

function padTxId(txid: string): string {
  return txid.padEnd(64, "0").substring(0, 64);
}

function calculateBlockId(height: number, transactions: Transaction[]): string {
  const txIds = transactions.map((tx) => padTxId(tx.id)).join("");
  const hashInput = `${height}${txIds}`;
  return createHash("sha256").update(hashInput).digest("hex");
}

async function waitForServerReady(
  maxRetries = 30,
  delayMs = 100
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${API_BASE_URL}/`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Server at ${API_BASE_URL} is not ready. Please ensure the server is running.`
  );
}

async function processBlock(
  block: Block
): Promise<{ success: true } | { error: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/blocks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(block),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: data.error || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Network error: ${message}` };
  }
}

async function getBalance(
  address: string
): Promise<{ balance: number } | { error: string }> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/balance/${encodeURIComponent(address)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        error: data.error || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return { balance: data.balance };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Network error: ${message}` };
  }
}

async function rollbackToHeight(
  height: number,
  timeoutMs?: number
): Promise<{ success: true } | { error: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (timeoutMs !== undefined) {
      headers["x-block-ttl"] = timeoutMs.toString();
    }

    const response = await fetch(
      `${API_BASE_URL}/rollback?height=${height}`,
      {
        method: "POST",
        headers,
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        error: data.error || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Network error: ${message}` };
  }
}

function formatBlockLog(block: Block, index: number): string {
  const lines: string[] = [];
  lines.push(`\n${"=".repeat(80)}`);
  lines.push(`Block ${index}: Height ${block.height}`);
  lines.push(`${"-".repeat(80)}`);
  lines.push(`Block ID: ${block.id}`);
  lines.push(`Transactions: ${block.transactions.length}`);
  lines.push("");

  block.transactions.forEach((tx, txIndex) => {
    lines.push(`  Transaction ${txIndex + 1}: ${tx.id.substring(0, 16)}...`);
    lines.push(`    Inputs (${tx.inputs.length}):`);
    tx.inputs.forEach((input, inputIndex) => {
      const isCoinbase = /^0+$/.test(input.txId);
      lines.push(
        `      ${inputIndex + 1}. ${
          isCoinbase ? "[COINBASE]" : input.txId.substring(0, 16) + "..."
        } (vout: ${input.index})`
      );
    });
    lines.push(`    Outputs (${tx.outputs.length}):`);
    tx.outputs.forEach((output, outputIndex) => {
      lines.push(
        `      ${outputIndex + 1}. ${
          output.address
        } → ${output.value.toLocaleString()}`
      );
    });
    lines.push("");
  });

  return lines.join("\n");
}

async function logBalances(addresses: string[]): Promise<void> {
  console.log("\n  Address Balances:");
  console.log("  " + "-".repeat(76));
  for (const address of addresses) {
    const result = await getBalance(address);
    if ("balance" in result) {
      console.log(
        `  ${address.padEnd(40)} ${result.balance
          .toLocaleString()
          .padStart(20)}`
      );
    } else {
      console.log(`  ${address.padEnd(40)} ERROR: ${result.error}`);
    }
  }
}

async function main() {
  console.log("🚀 Starting Block Processing Demonstration");
  console.log("=".repeat(80));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ ERROR: DATABASE_URL environment variable is required");
    process.exit(1);
  }

  try {
    console.log("\n📦 Initializing database...");
    await initializeDb(databaseUrl);
    console.log("✅ Database initialized");

    console.log("\n🧹 Cleaning database...");
    const db = getDb();
    await db.delete(utxos);
    console.log("✅ Database cleaned (all UTXOs removed)");

    console.log("\n🔍 Checking if API server is ready...");
    await waitForServerReady();
    console.log("✅ API server is ready");

    const addresses = new Set<string>();

    // Block 1: Coinbase transaction creating initial coins
    console.log("\n📦 Creating Block 1 (Coinbase)...");
    const block1Tx: Transaction = {
      id: padTxId(
        "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b"
      ),
      inputs: [
        {
          txId: padTxId(
            "0000000000000000000000000000000000000000000000000000000000000000"
          ),
          index: 5000000000,
        },
      ],
      outputs: [
        {
          address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
          value: 5000000000,
        },
      ],
    };
    const block1: Block = {
      id: calculateBlockId(1, [block1Tx]),
      height: 1,
      transactions: [block1Tx],
    };

    const result1 = await processBlock(block1);
    if ("error" in result1) {
      console.error(`❌ Error processing Block 1: ${result1.error}`);
      process.exit(1);
    }
    block1Tx.outputs.forEach((out) => addresses.add(out.address));
    console.log(formatBlockLog(block1, 1));
    await logBalances(Array.from(addresses));
    console.log("✅ Block 1 processed successfully");

    // Block 2: Transaction spending from Block 1
    console.log("\n📦 Creating Block 2...");
    const block2Tx: Transaction = {
      id: padTxId(
        "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16"
      ),
      inputs: [
        {
          txId: block1Tx.id,
          index: 0,
        },
      ],
      outputs: [
        {
          address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
          value: 2000000000,
        },
        {
          address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
          value: 3000000000,
        },
      ],
    };
    const block2: Block = {
      id: calculateBlockId(2, [block2Tx]),
      height: 2,
      transactions: [block2Tx],
    };

    const result2 = await processBlock(block2);
    if ("error" in result2) {
      console.error(`❌ Error processing Block 2: ${result2.error}`);
      process.exit(1);
    }
    block2Tx.outputs.forEach((out) => addresses.add(out.address));
    console.log(formatBlockLog(block2, 2));
    await logBalances(Array.from(addresses));
    console.log("✅ Block 2 processed successfully");

    // Block 3: Transaction spending from Block 2
    console.log("\n📦 Creating Block 3...");
    const block3Tx: Transaction = {
      id: padTxId(
        "a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d"
      ),
      inputs: [
        {
          txId: block2Tx.id,
          index: 0,
        },
      ],
      outputs: [
        {
          address: "1CounterpartyXXXXXXXXXXXXXXXUWLpVr",
          value: 1000000000,
        },
        {
          address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
          value: 1000000000,
        },
      ],
    };
    const block3: Block = {
      id: calculateBlockId(3, [block3Tx]),
      height: 3,
      transactions: [block3Tx],
    };

    const result3 = await processBlock(block3);
    if ("error" in result3) {
      console.error(`❌ Error processing Block 3: ${result3.error}`);
      process.exit(1);
    }
    block3Tx.outputs.forEach((out) => addresses.add(out.address));
    console.log(formatBlockLog(block3, 3));
    await logBalances(Array.from(addresses));
    console.log("✅ Block 3 processed successfully");

    // Block 4: Transaction spending from Block 3
    console.log("\n📦 Creating Block 4...");
    const block4Tx: Transaction = {
      id: padTxId(
        "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3"
      ),
      inputs: [
        {
          txId: block3Tx.id,
          index: 1,
        },
      ],
      outputs: [
        {
          address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
          value: 500000000,
        },
        {
          address: "1CounterpartyXXXXXXXXXXXXXXXUWLpVr",
          value: 500000000,
        },
      ],
    };
    const block4: Block = {
      id: calculateBlockId(4, [block4Tx]),
      height: 4,
      transactions: [block4Tx],
    };

    const result4 = await processBlock(block4);
    if ("error" in result4) {
      console.error(`❌ Error processing Block 4: ${result4.error}`);
      process.exit(1);
    }
    block4Tx.outputs.forEach((out) => addresses.add(out.address));
    console.log(formatBlockLog(block4, 4));
    await logBalances(Array.from(addresses));
    console.log("✅ Block 4 processed successfully");

    // Rollback Demonstration
    console.log("\n" + "=".repeat(80));
    console.log("🔄 Rollback Demonstration");
    console.log("=".repeat(80));

    console.log("\n📊 Balances before rollback:");
    await logBalances(Array.from(addresses));

    console.log("\n🔄 Rolling back to height 2 (removes blocks 3 and 4)...");
    const rollbackResult = await rollbackToHeight(2);
    if ("error" in rollbackResult) {
      console.error(`❌ Error performing rollback: ${rollbackResult.error}`);
      process.exit(1);
    }
    console.log("✅ Rollback to height 2 completed successfully");

    console.log("\n📊 Balances after rollback:");
    await logBalances(Array.from(addresses));
    console.log(
      "\n💡 Note: UTXOs from blocks 3 and 4 have been removed, and UTXOs"
    );
    console.log(
      "   that were spent by transactions in those blocks have been restored."
    );

    // Rollback Error Demonstrations
    console.log("\n" + "=".repeat(80));
    console.log("⚠️  Rollback Error Demonstrations");
    console.log("=".repeat(80));

    // Error 1: Rollback to invalid height (greater than current)
    console.log("\n❌ Rollback Error Demo 1: Invalid Height (greater than current)");
    console.log("   Attempting to rollback to height 999 (greater than current)...");
    const errorRollback1 = await rollbackToHeight(999);
    if ("error" in errorRollback1) {
      console.log(`   ✅ Expected error received: ${errorRollback1.error}`);
    } else {
      console.log("   ⚠️  Unexpected: Rollback was successful");
    }

    // Error 2: Rollback to negative height
    console.log("\n❌ Rollback Error Demo 2: Invalid Height (negative)");
    console.log("   Attempting to rollback to height -1...");
    const errorRollback2 = await rollbackToHeight(-1);
    if ("error" in errorRollback2) {
      console.log(`   ✅ Expected error received: ${errorRollback2.error}`);
    } else {
      console.log("   ⚠️  Unexpected: Rollback was successful");
    }

    // Error Handling Demonstrations
    console.log("\n" + "=".repeat(80));
    console.log("⚠️  Error Handling Demonstrations");
    console.log("=".repeat(80));

    // Error 1: Invalid Block Height (skipping height 5, trying height 6)
    console.log("\n❌ Error Demo 1: Invalid Block Height");
    console.log(
      "   Attempting to process block with height 6 (should be 5)..."
    );
    const invalidHeightBlock: Block = {
      id: calculateBlockId(6, [block4Tx]),
      height: 6,
      transactions: [block4Tx],
    };
    const errorResult1 = await processBlock(invalidHeightBlock);
    if ("error" in errorResult1) {
      console.log(`   ✅ Expected error received: ${errorResult1.error}`);
    } else {
      console.log("   ⚠️  Unexpected: Block was processed successfully");
    }

    // Error 2: Invalid Input/Output Sum
    console.log("\n❌ Error Demo 2: Invalid Input/Output Sum");
    console.log("   Attempting to process block where inputs ≠ outputs...");
    const invalidSumTx: Transaction = {
      id: padTxId("invalid_sum_tx_1234567890123456789012345678901234567890"),
      inputs: [
        {
          txId: block4Tx.id,
          index: 0,
        },
      ],
      outputs: [
        {
          address: "1TestAddressXXXXXXXXXXXXXXXXXXXXXX",
          value: 10000000000, // More than input (should be 500000000)
        },
      ],
    };
    const invalidSumBlock: Block = {
      id: calculateBlockId(5, [invalidSumTx]),
      height: 5,
      transactions: [invalidSumTx],
    };
    const errorResult2 = await processBlock(invalidSumBlock);
    if ("error" in errorResult2) {
      console.log(`   ✅ Expected error received: ${errorResult2.error}`);
    } else {
      console.log("   ⚠️  Unexpected: Block was processed successfully");
    }

    // Error 3: Invalid Block ID
    console.log("\n❌ Error Demo 3: Invalid Block ID");
    console.log("   Attempting to process block with incorrect block ID...");
    const invalidBlockIdTx: Transaction = {
      id: padTxId("valid_tx_id_1234567890123456789012345678901234567890"),
      inputs: [
        {
          txId: block4Tx.id,
          index: 1, // Use different UTXO than error demo 2
        },
      ],
      outputs: [
        {
          address: "1TestAddressXXXXXXXXXXXXXXXXXXXXXX",
          value: 500000000,
        },
      ],
    };
    const invalidBlockIdBlock: Block = {
      id: "invalid_block_id_that_does_not_match_the_calculated_hash",
      height: 5,
      transactions: [invalidBlockIdTx],
    };
    const errorResult3 = await processBlock(invalidBlockIdBlock);
    if ("error" in errorResult3) {
      console.log(`   ✅ Expected error received: ${errorResult3.error}`);
    } else {
      console.log("   ⚠️  Unexpected: Block was processed successfully");
    }

    // Error 4: UTXO Not Found (spending non-existent UTXO)
    console.log("\n❌ Error Demo 4: UTXO Not Found");
    console.log("   Attempting to spend a UTXO that doesn't exist...");
    const nonExistentUtxoTx: Transaction = {
      id: padTxId("non_existent_utxo_tx_123456789012345678901234567890"),
      inputs: [
        {
          txId: padTxId(
            "0000000000000000000000000000000000000000000000000000000000000001"
          ), // Non-existent transaction ID
          index: 0,
        },
      ],
      outputs: [
        {
          address: "1TestAddressXXXXXXXXXXXXXXXXXXXXXX",
          value: 1000000000,
        },
      ],
    };
    const nonExistentUtxoBlock: Block = {
      id: calculateBlockId(5, [nonExistentUtxoTx]),
      height: 5,
      transactions: [nonExistentUtxoTx],
    };
    const errorResult4 = await processBlock(nonExistentUtxoBlock);
    if ("error" in errorResult4) {
      console.log(`   ✅ Expected error received: ${errorResult4.error}`);
    } else {
      console.log("   ⚠️  Unexpected: Block was processed successfully");
    }

    // Error 5: Spending More Than Account Balance
    console.log("\n❌ Error Demo 5: Spending More Than Account Balance");
    console.log("   Attempting to spend more than available balance...");
    const testAddress = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
    const balanceCheck = await getBalance(testAddress);
    if ("balance" in balanceCheck) {
      console.log(
        `   Current balance of ${testAddress}: ${balanceCheck.balance.toLocaleString()}`
      );
      console.log(
        `   Attempting to spend ${(
          balanceCheck.balance + 1000000000
        ).toLocaleString()} (more than balance)...`
      );
    } else {
      console.log(`   Could not check balance: ${balanceCheck.error}`);
    }
    // Try to spend from block4Tx output at index 0 (500000000) but output more than that
    // We'll use a valid UTXO but try to output more than the input value
    const overspendTx: Transaction = {
      id: padTxId("overspend_tx_1234567890123456789012345678901234567890"),
      inputs: [
        {
          txId: block4Tx.id,
          index: 0, // This UTXO has value 500000000
        },
      ],
      outputs: [
        {
          address: "1TestAddressXXXXXXXXXXXXXXXXXXXXXX",
          value: 10000000000, // Much more than the input value
        },
      ],
    };
    const overspendBlock: Block = {
      id: calculateBlockId(5, [overspendTx]),
      height: 5,
      transactions: [overspendTx],
    };
    const errorResult5 = await processBlock(overspendBlock);
    if ("error" in errorResult5) {
      console.log(`   ✅ Expected error received: ${errorResult5.error}`);
    } else {
      console.log("   ⚠️  Unexpected: Block was processed successfully");
    }

    console.log("\n" + "=".repeat(80));
    console.log("🎉 Demonstration completed successfully!");
    console.log(`   Processed ${4} blocks`);
    console.log(`   Tracked ${addresses.size} addresses`);
    console.log(`   Demonstrated rollback functionality`);
    console.log(`   Demonstrated ${5} error scenarios`);
    console.log("=".repeat(80));
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

main();
