import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Container } from "inversify";
import "reflect-metadata";
import { createHash } from "crypto";
import { eq, gt } from "drizzle-orm";
import { getDb, initializeDb } from "../../src/db";
import { utxos } from "../../src/db/schema";
import { InvalidRollbackHeightError } from "../../src/errors";
import type { IUTXORepository } from "../../src/repositories/utxo.repository";
import { BalanceService } from "../../src/services/balance.service";
import { BlockService } from "../../src/services/block.service";
import { RollbackService } from "../../src/services/rollback.service";
import type { Block, Transaction } from "../../src/types/block.types";
import { TYPES } from "../../src/types/di.types";
import { createIntegrationTestContainer, padTxId } from "../test-setup";

function calculateBlockId(height: number, transactions: Transaction[]): string {
  const txIds = transactions.map((tx) => padTxId(tx.id)).join("");
  const hashInput = `${height}${txIds}`;
  return createHash("sha256").update(hashInput).digest("hex");
}

function createValidBlock(height: number, transactions: Transaction[]): Block {
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

/**
 * Integration tests for RollbackService using a real database
 */
describe("RollbackService Integration Tests", () => {
  let container: Container;
  let rollbackService: RollbackService;
  let blockService: BlockService;
  let balanceService: BalanceService;
  let repository: IUTXORepository;

  beforeAll(async () => {
    const databaseUrl =
      process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL or TEST_DATABASE_URL is not set");
    }

    await initializeDb(databaseUrl);

    container = createIntegrationTestContainer();
    rollbackService = container.get<RollbackService>(TYPES.RollbackService);
    blockService = container.get<BlockService>(TYPES.BlockService);
    balanceService = container.get<BalanceService>(TYPES.BalanceService);
    repository = container.get<IUTXORepository>(TYPES.IUTXORepository);
  });

  beforeEach(async () => {
    // Clear all UTXOs before each test
    const db = getDb();
    await db.delete(utxos);
  });

  describe("rollbackToHeight - Validation", () => {
    test("should return error when target height is negative", async () => {
      const result = await rollbackService.rollbackToHeight(-1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidRollbackHeightError);
      }
    });

    test("should return error when target height is greater than current height", async () => {
      // Process a block at height 1
      const block1 = createValidBlock(1, [
        { id: "tx1", inputs: [], outputs: [{ address: "addr1", value: 100 }] },
      ]);
      await blockService.processBlock(block1);

      const result = await rollbackService.rollbackToHeight(5);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidRollbackHeightError);
      }
    });
  });

  describe("rollbackToHeight - Rollback Logic", () => {
    test("should delete UTXOs created after target height", async () => {
      // Process blocks at different heights using coinbase transactions
      const block1 = createValidBlock(1, [
        {
          id: "tx1",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 0,
            },
          ],
          outputs: [{ address: "addr1", value: 100 }],
        },
      ]);
      const result1 = await blockService.processBlock(block1);
      expect(result1.isOk()).toBe(true);

      const block2 = createValidBlock(2, [
        {
          id: "tx2",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 0,
            },
          ],
          outputs: [{ address: "addr2", value: 50 }],
        },
      ]);
      const result2 = await blockService.processBlock(block2);
      expect(result2.isOk()).toBe(true);

      const block3 = createValidBlock(3, [
        {
          id: "tx3",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 0,
            },
          ],
          outputs: [{ address: "addr3", value: 25 }],
        },
      ]);
      const result3 = await blockService.processBlock(block3);
      expect(result3.isOk()).toBe(true);

      // Rollback to height 1
      const result = await rollbackService.rollbackToHeight(1);
      expect(result.isOk()).toBe(true);

      // Verify UTXOs at height 1 still exist
      const db = getDb();
      const utxosAtHeight1 = await db
        .select()
        .from(utxos)
        .where(eq(utxos.blockHeight, 1));

      expect(utxosAtHeight1.length).toBe(1);
      expect(utxosAtHeight1[0].txid).toBe(padTxId("tx1"));

      // Verify UTXOs at heights 2 and 3 are deleted
      const utxosAfterHeight1 = await db
        .select()
        .from(utxos)
        .where(gt(utxos.blockHeight, 1));

      expect(utxosAfterHeight1.length).toBe(0);
    });

    test("should unmark UTXOs that were spent by transactions in rolled-back blocks", async () => {
      // Process block 1: create UTXO using coinbase transaction
      const block1 = createValidBlock(1, [
        {
          id: "tx1",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 0,
            },
          ],
          outputs: [{ address: "addr1", value: 100 }],
        },
      ]);
      const result1 = await blockService.processBlock(block1);
      expect(result1.isOk()).toBe(true);

      // Process block 2: spend tx1:0 and create new UTXO
      const block2 = createValidBlock(2, [
        {
          id: "tx2",
          inputs: [{ txId: "tx1", index: 0 }],
          outputs: [{ address: "addr2", value: 100 }],
        },
      ]);
      await blockService.processBlock(block2);

      // Verify tx1:0 is spent by checking balance (should be 0)
      const balanceBeforeRollback = await balanceService.getBalance("addr1");
      expect(balanceBeforeRollback.isOk()).toBe(true);
      if (balanceBeforeRollback.isOk()) {
        expect(balanceBeforeRollback.value).toBe(0); // Spent
      }

      // Rollback to height 1
      const result = await rollbackService.rollbackToHeight(1);
      expect(result.isOk()).toBe(true);

      // Verify tx1:0 is unmarked as spent by checking balance (should be 100)
      const balanceAfterRollback = await balanceService.getBalance("addr1");
      expect(balanceAfterRollback.isOk()).toBe(true);
      if (balanceAfterRollback.isOk()) {
        expect(balanceAfterRollback.value).toBe(100); // Unspent after rollback
      }

      // Also verify via repository that it's unspent
      const utxosResult = await repository.findByTxIdsAndVouts([
        { txId: padTxId("tx1"), vout: 0 },
      ]);
      expect(utxosResult.isOk()).toBe(true);
      if (utxosResult.isOk()) {
        expect(utxosResult.value.length).toBe(1);
        expect(utxosResult.value[0].spent).toBe(false);
      }
    });

    test("should handle rollback scenario from README example", async () => {
      // Height 1: tx1 creates output to addr1 with value 10 using coinbase transaction
      const block1 = createValidBlock(1, [
        {
          id: "tx1",
          inputs: [
            {
              txId: "0000000000000000000000000000000000000000000000000000000000000000",
              index: 0,
            },
          ],
          outputs: [{ address: "addr1", value: 10 }],
        },
      ]);
      const result1 = await blockService.processBlock(block1);
      expect(result1.isOk()).toBe(true);

      // Height 2: tx2 spends tx1:0, creates outputs to addr2 (4) and addr3 (6)
      const block2 = createValidBlock(2, [
        {
          id: "tx2",
          inputs: [{ txId: "tx1", index: 0 }],
          outputs: [
            { address: "addr2", value: 4 },
            { address: "addr3", value: 6 },
          ],
        },
      ]);
      await blockService.processBlock(block2);

      // Height 3: tx3 spends tx2:1, creates outputs to addr4, addr5, addr6 (each 2)
      const block3 = createValidBlock(3, [
        {
          id: "tx3",
          inputs: [{ txId: "tx2", index: 1 }],
          outputs: [
            { address: "addr4", value: 2 },
            { address: "addr5", value: 2 },
            { address: "addr6", value: 2 },
          ],
        },
      ]);
      await blockService.processBlock(block3);

      // Rollback to height 2
      const rollbackResult = await rollbackService.rollbackToHeight(2);
      expect(rollbackResult.isOk()).toBe(true);

      // Verify balances match expected state after rollback:
      // addr1: 0, addr2: 4, addr3: 6
      const addr1Balance = await balanceService.getBalance("addr1");
      const addr2Balance = await balanceService.getBalance("addr2");
      const addr3Balance = await balanceService.getBalance("addr3");
      const addr4Balance = await balanceService.getBalance("addr4");
      const addr5Balance = await balanceService.getBalance("addr5");
      const addr6Balance = await balanceService.getBalance("addr6");

      expect(addr1Balance.isOk()).toBe(true);
      expect(addr2Balance.isOk()).toBe(true);
      expect(addr3Balance.isOk()).toBe(true);
      expect(addr4Balance.isOk()).toBe(true);
      expect(addr5Balance.isOk()).toBe(true);
      expect(addr6Balance.isOk()).toBe(true);

      if (
        addr1Balance.isOk() &&
        addr2Balance.isOk() &&
        addr3Balance.isOk() &&
        addr4Balance.isOk() &&
        addr5Balance.isOk() &&
        addr6Balance.isOk()
      ) {
        expect(addr1Balance.value).toBe(0); // tx1:0 was spent by tx2
        expect(addr2Balance.value).toBe(4); // tx2:0
        expect(addr3Balance.value).toBe(6); // tx2:1 (unspent after rollback)
        expect(addr4Balance.value).toBe(0); // tx3 outputs deleted
        expect(addr5Balance.value).toBe(0); // tx3 outputs deleted
        expect(addr6Balance.value).toBe(0); // tx3 outputs deleted
      }
    });
  });
});

