import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { Container } from "inversify";
import "reflect-metadata";
import {
  InvalidBlockHeightError,
  InvalidBlockIdError,
  InvalidInputOutputSumError,
} from "../../src/errors";
import { BlockService } from "../../src/services/block.service";
import type { Block, Transaction } from "../../src/types/block.types";
import { TYPES } from "../../src/types/di.types";
import { InMemoryUTXORepository } from "../repositories/in-memory-utxo.repository";
import { createTestContainer, padTxId } from "../test-setup";

function calculateBlockId(height: number, transactions: Transaction[]): string {
  const txIds = transactions.map((tx) => tx.id).join("");
  const hashInput = `${height}${txIds}`;
  return createHash("sha256").update(hashInput).digest("hex");
}

function createValidBlock(height: number, transactions: Transaction[]): Block {
  // Pad transaction IDs to 64 characters for database compatibility
  const paddedTransactions = transactions.map((tx) => ({
    ...tx,
    id: padTxId(tx.id),
    inputs: tx.inputs.map((input) => ({
      ...input,
      txId: padTxId(input.txId),
    })),
  }));
  const id = calculateBlockId(height, paddedTransactions);
  return {
    id,
    height,
    transactions: paddedTransactions,
  };
}

describe("BlockService", () => {
  let container: Container;
  let blockService: BlockService;
  let repository: InMemoryUTXORepository;

  beforeEach(() => {
    container = createTestContainer();
    blockService = container.get<BlockService>(TYPES.BlockService);
    repository = container.get<InMemoryUTXORepository>(
      TYPES.IUTXORepository
    ) as InMemoryUTXORepository;
    repository.clearAll();
  });

  describe("processBlock - Success Cases", () => {
    test("should process first block (height 1) with transaction having no inputs", async () => {
      // Note: The current implementation requires that if a block has no inputs,
      // all transactions must have output sum of 0 (see validateInputOutputSum in block.service.ts)
      // So for the first block, we'll use empty outputs
      const transactions: Transaction[] = [
        {
          id: "tx1",
          inputs: [],
          outputs: [], // Empty outputs - implementation requires sum to be 0 when block has no inputs
        },
      ];

      const block = createValidBlock(1, transactions);
      const result = await blockService.processBlock(block);

      if (result.isErr()) {
        console.error("Error:", result.error);
      }
      expect(result.isOk()).toBe(true);

      // Verify no UTXOs were created
      const maxHeightResult = await repository.getMaxBlockHeight();
      expect(maxHeightResult.isOk()).toBe(true);
      if (maxHeightResult.isOk()) {
        expect(maxHeightResult.value).toBe(0);
      }
    });

    test("should process subsequent blocks with valid transactions", async () => {
      // First, process block at height 1 (transaction with no inputs and empty outputs)
      const firstBlock = createValidBlock(1, [
        { id: "tx0", inputs: [], outputs: [] },
      ]);
      await blockService.processBlock(firstBlock);

      // Insert a UTXO to simulate it was created in a previous block
      // (In reality, the first block can't create UTXOs due to validation)
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      // Now process a second block that spends the UTXO
      const secondBlockTransactions: Transaction[] = [
        {
          id: "tx2",
          inputs: [{ txId: "tx1", index: 0 }],
          outputs: [
            { address: "addr2", value: 60 },
            { address: "addr3", value: 40 },
          ],
        },
      ];
      const secondBlock = createValidBlock(2, secondBlockTransactions);
      const result = await blockService.processBlock(secondBlock);

      if (result.isErr()) {
        console.error("Error processing block:", result.error);
      }
      expect(result.isOk()).toBe(true);

      // Verify the input UTXO was marked as spent
      const spentUTXOResult = await repository.findByTxIdsAndVouts([
        { txId: padTxId("tx1"), vout: 0 },
      ]);
      expect(spentUTXOResult.isOk()).toBe(true);
      if (spentUTXOResult.isOk() && spentUTXOResult.value.length > 0) {
        const utxo = spentUTXOResult.value[0];
        expect(utxo.spent).toBe(true);
        expect(utxo.spentTxid).toBe(padTxId("tx2"));
      }

      // Verify new UTXOs were created
      const balance2Result = await repository.getBalanceByAddress("addr2");
      const balance3Result = await repository.getBalanceByAddress("addr3");
      expect(balance2Result.isOk()).toBe(true);
      expect(balance3Result.isOk()).toBe(true);
      if (balance2Result.isOk() && balance3Result.isOk()) {
        expect(balance2Result.value).toBe(60);
        expect(balance3Result.value).toBe(40);
      }
    });

    test("should process block with multiple transactions", async () => {
      // First, process block at height 1
      const firstBlock = createValidBlock(1, [
        { id: "tx0", inputs: [], outputs: [] },
      ]);
      await blockService.processBlock(firstBlock);

      // Create initial UTXOs
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx2"),
        vout: 0,
        address: "addr2",
        value: 50,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const transactions: Transaction[] = [
        {
          id: "tx3",
          inputs: [{ txId: "tx1", index: 0 }],
          outputs: [{ address: "addr3", value: 100 }],
        },
        {
          id: "tx4",
          inputs: [{ txId: "tx2", index: 0 }],
          outputs: [{ address: "addr4", value: 50 }],
        },
      ];

      const block = createValidBlock(2, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);

      // Verify both transactions were processed
      const balance3Result = await repository.getBalanceByAddress("addr3");
      const balance4Result = await repository.getBalanceByAddress("addr4");
      expect(balance3Result.isOk()).toBe(true);
      expect(balance4Result.isOk()).toBe(true);
      if (balance3Result.isOk() && balance4Result.isOk()) {
        expect(balance3Result.value).toBe(100);
        expect(balance4Result.value).toBe(50);
      }

      // Verify inputs were spent
      const utxosResult = await repository.findByTxIdsAndVouts([
        { txId: padTxId("tx1"), vout: 0 },
        { txId: padTxId("tx2"), vout: 0 },
      ]);
      expect(utxosResult.isOk()).toBe(true);
      if (utxosResult.isOk()) {
        const tx1Utxo = utxosResult.value.find(
          (u) => u.txid === padTxId("tx1") && u.vout === 0
        );
        const tx2Utxo = utxosResult.value.find(
          (u) => u.txid === padTxId("tx2") && u.vout === 0
        );
        // Note: findByTxIdsAndVouts only returns unspent UTXOs, so we check via balance instead
        // The UTXOs should be spent, so they won't appear in the unspent list
        const balance1Result = await repository.getBalanceByAddress("addr1");
        const balance2Result = await repository.getBalanceByAddress("addr2");
        expect(balance1Result.isOk() && balance1Result.value).toBe(0);
        expect(balance2Result.isOk() && balance2Result.value).toBe(0);
      }
    });

    test("should process block that spends multiple UTXOs", async () => {
      // First, process block at height 1
      const firstBlock = createValidBlock(1, [
        { id: "tx0", inputs: [], outputs: [] },
      ]);
      await blockService.processBlock(firstBlock);

      // Create multiple UTXOs
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 30,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx2"),
        vout: 0,
        address: "addr2",
        value: 20,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx3"),
        vout: 0,
        address: "addr3",
        value: 50,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const transactions: Transaction[] = [
        {
          id: "tx4",
          inputs: [
            { txId: "tx1", index: 0 },
            { txId: "tx2", index: 0 },
            { txId: "tx3", index: 0 },
          ],
          outputs: [{ address: "addr4", value: 100 }],
        },
      ];

      const block = createValidBlock(2, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);

      // Verify all inputs were marked as spent (check via balance - spent UTXOs won't appear in balance)
      const balance1Result = await repository.getBalanceByAddress("addr1");
      const balance2Result = await repository.getBalanceByAddress("addr2");
      const balance3Result = await repository.getBalanceByAddress("addr3");
      expect(balance1Result.isOk() && balance1Result.value).toBe(0);
      expect(balance2Result.isOk() && balance2Result.value).toBe(0);
      expect(balance3Result.isOk() && balance3Result.value).toBe(0);

      // Verify new output was created
      const balance4Result = await repository.getBalanceByAddress("addr4");
      expect(balance4Result.isOk()).toBe(true);
      if (balance4Result.isOk()) {
        expect(balance4Result.value).toBe(100);
      }
    });

    test("should process coinbase transaction with all-zero txId input", async () => {
      // Coinbase transaction creates new coins, so it can have any output sum
      const transactions: Transaction[] = [
        {
          id: "tx1",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 5000000000,
            },
          ],
          outputs: [{ address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", value: 5000000000 }],
        },
      ];

      const block = createValidBlock(1, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);

      // Verify UTXO was created
      const balanceResult = await repository.getBalanceByAddress(
        "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
      );
      expect(balanceResult.isOk()).toBe(true);
      if (balanceResult.isOk()) {
        expect(balanceResult.value).toBe(5000000000);
      }
    });

    test("should process coinbase transaction with different output sum than input index", async () => {
      // Coinbase transactions can have any output sum, independent of input index
      const transactions: Transaction[] = [
        {
          id: "tx1",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 0,
            },
          ],
          outputs: [
            { address: "addr1", value: 100 },
            { address: "addr2", value: 50 },
          ],
        },
      ];

      const block = createValidBlock(1, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);

      // Verify UTXOs were created
      const balance1Result = await repository.getBalanceByAddress("addr1");
      const balance2Result = await repository.getBalanceByAddress("addr2");
      expect(balance1Result.isOk()).toBe(true);
      expect(balance2Result.isOk()).toBe(true);
      if (balance1Result.isOk() && balance2Result.isOk()) {
        expect(balance1Result.value).toBe(100);
        expect(balance2Result.value).toBe(50);
      }
    });

    test("should process block with both coinbase and regular transactions", async () => {
      // First, create a UTXO
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const transactions: Transaction[] = [
        {
          id: "tx2",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 0,
            },
          ],
          outputs: [{ address: "addr2", value: 50 }], // Coinbase transaction
        },
        {
          id: "tx3",
          inputs: [{ txId: "tx1", index: 0 }],
          outputs: [{ address: "addr3", value: 100 }], // Regular transaction
        },
      ];

      const block = createValidBlock(2, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);

      // Verify coinbase output was created
      const balance2Result = await repository.getBalanceByAddress("addr2");
      expect(balance2Result.isOk()).toBe(true);
      if (balance2Result.isOk()) {
        expect(balance2Result.value).toBe(50);
      }

      // Verify regular transaction output was created
      const balance3Result = await repository.getBalanceByAddress("addr3");
      expect(balance3Result.isOk()).toBe(true);
      if (balance3Result.isOk()) {
        expect(balance3Result.value).toBe(100);
      }
    });
  });

  describe("processBlock - Height Validation Errors", () => {
    test("should reject block with height that's too low", async () => {
      // Create a block at height 1
      const firstBlock = createValidBlock(1, [
        {
          id: "tx1",
          inputs: [],
          outputs: [],
        },
      ]);
      await blockService.processBlock(firstBlock);

      // Insert a UTXO at height 1 to set the max height
      // (Height validation is based on UTXO block heights, not blocks processed)
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 0,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      // Try to process another block at height 1 (should fail - expecting height 2)
      const invalidBlock = createValidBlock(1, [
        {
          id: "tx2",
          inputs: [],
          outputs: [],
        },
      ]);
      const result = await blockService.processBlock(invalidBlock);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidBlockHeightError);
      }
    });

    test("should reject block with height that's too high (not sequential)", async () => {
      // Create a block at height 1
      const firstBlock = createValidBlock(1, [
        {
          id: "tx1",
          inputs: [],
          outputs: [{ address: "addr1", value: 10 }],
        },
      ]);
      await blockService.processBlock(firstBlock);

      // Try to process a block at height 3 (should fail, expecting height 2)
      const invalidBlock = createValidBlock(3, [
        {
          id: "tx2",
          inputs: [],
          outputs: [{ address: "addr2", value: 10 }],
        },
      ]);
      const result = await blockService.processBlock(invalidBlock);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidBlockHeightError);
      }
    });

    test("should reject block with height 0 when expecting height 1", async () => {
      const invalidBlock = createValidBlock(0, [
        {
          id: "tx1",
          inputs: [],
          outputs: [{ address: "addr1", value: 10 }],
        },
      ]);
      const result = await blockService.processBlock(invalidBlock);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidBlockHeightError);
      }
    });
  });

  describe("processBlock - Input/Output Sum Validation Errors", () => {
    test("should reject block where input sum doesn't equal output sum", async () => {
      // Create a UTXO
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const transactions: Transaction[] = [
        {
          id: "tx2",
          inputs: [{ txId: "tx1", index: 0 }],
          outputs: [
            { address: "addr2", value: 60 },
            { address: "addr3", value: 50 }, // Total 110, but input is 100
          ],
        },
      ];

      const block = createValidBlock(2, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidInputOutputSumError);
      }
    });

    test("should reject block with no inputs where output sum is not 0", async () => {
      // The current implementation requires: if a block has no inputs, all transactions must have output sum of 0
      // (see validateInputOutputSum in block.service.ts)
      const transactions: Transaction[] = [
        {
          id: "tx1",
          inputs: [],
          outputs: [{ address: "addr1", value: 10 }], // Non-zero output with no inputs
        },
      ];

      const block = createValidBlock(1, transactions);
      const result = await blockService.processBlock(block);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidInputOutputSumError);
      }
    });

    test("should reject block where referenced UTXO doesn't exist", async () => {
      const transactions: Transaction[] = [
        {
          id: "tx2",
          inputs: [{ txId: "nonexistent", index: 0 }],
          outputs: [{ address: "addr2", value: 100 }],
        },
      ];

      const block = createValidBlock(1, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidInputOutputSumError);
      }
    });

    test("should reject block where referenced UTXO is already spent", async () => {
      // Create and spend a UTXO
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });
      await repository.markAsSpent(padTxId("tx1"), 0, padTxId("tx2"));

      // Try to spend it again
      const transactions: Transaction[] = [
        {
          id: "tx3",
          inputs: [{ txId: "tx1", index: 0 }],
          outputs: [{ address: "addr2", value: 100 }],
        },
      ];

      const block = createValidBlock(2, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidInputOutputSumError);
      }
    });

    test("should reject transaction with both coinbase and regular inputs", async () => {
      // Create a UTXO
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const transactions: Transaction[] = [
        {
          id: "tx2",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 0,
            }, // Coinbase input
            { txId: "tx1", index: 0 }, // Regular input
          ],
          outputs: [{ address: "addr2", value: 150 }],
        },
      ];

      const block = createValidBlock(2, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidInputOutputSumError);
      }
    });
  });

  describe("processBlock - Block ID Validation Errors", () => {
    test("should reject block with incorrect block ID hash", async () => {
      const transactions: Transaction[] = [
        {
          id: "tx1",
          inputs: [],
          outputs: [{ address: "addr1", value: 0 }],
        },
      ];

      const block: Block = {
        id: "wrong_hash",
        height: 1,
        transactions,
      };

      const result = await blockService.processBlock(block);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidBlockIdError);
      }
    });

    test("should accept block with correct hash calculation", async () => {
      const transactions: Transaction[] = [
        {
          id: "tx1",
          inputs: [],
          outputs: [{ address: "addr1", value: 0 }],
        },
        {
          id: "tx2",
          inputs: [],
          outputs: [{ address: "addr2", value: 0 }],
        },
      ];

      const block = createValidBlock(1, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);
    });
  });

  describe("processBlock - Edge Cases", () => {
    test("should handle block with empty transactions array", async () => {
      const block = createValidBlock(1, []);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);
    });

    test("should handle transaction with empty inputs and outputs", async () => {
      const transactions: Transaction[] = [
        {
          id: "tx1",
          inputs: [],
          outputs: [],
        },
      ];

      const block = createValidBlock(1, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);
    });

    test("should handle transaction with multiple inputs and outputs", async () => {
      // First, process block at height 1
      const firstBlock = createValidBlock(1, [
        { id: "tx0", inputs: [], outputs: [] },
      ]);
      await blockService.processBlock(firstBlock);

      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 50,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx2"),
        vout: 0,
        address: "addr2",
        value: 30,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx3"),
        vout: 0,
        address: "addr3",
        value: 20,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const transactions: Transaction[] = [
        {
          id: "tx4",
          inputs: [
            { txId: "tx1", index: 0 },
            { txId: "tx2", index: 0 },
            { txId: "tx3", index: 0 },
          ],
          outputs: [
            { address: "addr4", value: 60 },
            { address: "addr5", value: 40 },
          ],
        },
      ];

      const block = createValidBlock(2, transactions);
      const result = await blockService.processBlock(block);

      expect(result.isOk()).toBe(true);
    });

    test("should reject block that tries to spend UTXO from same block", async () => {
      // First create a UTXO in block 1
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      // Try to create a block that spends tx1 and creates tx2, then tries to spend tx2 in same block
      // This should fail because tx2 doesn't exist yet when validating
      const transactions: Transaction[] = [
        {
          id: "tx2",
          inputs: [{ txId: "tx1", index: 0 }],
          outputs: [{ address: "addr2", value: 100 }],
        },
        {
          id: "tx3",
          inputs: [{ txId: "tx2", index: 0 }], // Trying to spend tx2 from same block
          outputs: [{ address: "addr3", value: 100 }],
        },
      ];

      const block = createValidBlock(2, transactions);
      const result = await blockService.processBlock(block);

      // This should fail because tx2 UTXO doesn't exist when validating tx3
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidInputOutputSumError);
      }
    });
  });
});
