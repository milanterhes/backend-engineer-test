import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Container } from "inversify";
import "reflect-metadata";
import { getDb, initializeDb } from "../../src/db";
import { utxos } from "../../src/db/schema";
import { UTXORepository } from "../../src/repositories/utxo.repository.impl";
import { BalanceService } from "../../src/services/balance.service";
import { BlockService } from "../../src/services/block.service";
import { TYPES } from "../../src/types/di.types";
import { createIntegrationTestContainer, padTxId } from "../test-setup";

/**
 * Integration tests for UTXORepository using a real database
 * These tests verify that the repository implementation works correctly with PostgreSQL
 */
describe("UTXORepository Integration Tests", () => {
  let container: Container;
  let repository: UTXORepository;
  let balanceService: BalanceService;
  let blockService: BlockService;

  beforeAll(async () => {
    const databaseUrl =
      process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL or TEST_DATABASE_URL is not set");
    }

    await initializeDb(databaseUrl);

    // Create container with real repository
    container = createIntegrationTestContainer();
    repository = container.get<UTXORepository>(
      TYPES.IUTXORepository
    ) as UTXORepository;
    balanceService = container.get<BalanceService>(TYPES.BalanceService);
    blockService = container.get<BlockService>(TYPES.BlockService);
  });

  beforeEach(async () => {
    // Clear all UTXOs before each test
    const db = getDb();
    await db.delete(utxos);
  });

  describe("Repository with real database", () => {
    test("should insert and retrieve UTXOs", async () => {
      const insertResult = await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      expect(insertResult.isOk()).toBe(true);

      const findResult = await repository.findByTxIdsAndVouts([
        { txId: padTxId("tx1"), vout: 0 },
      ]);
      expect(findResult.isOk()).toBe(true);
      if (findResult.isOk() && findResult.value.length > 0) {
        const utxo = findResult.value[0];
        expect(utxo.address).toBe("addr1");
        expect(utxo.value).toBe(100);
        expect(utxo.spent).toBe(false);
      }
    });

    test("should calculate balance correctly", async () => {
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
        address: "addr1",
        value: 30,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx3"),
        vout: 0,
        address: "addr1",
        value: 20,
        scriptPubkey: "",
        blockHeight: 1,
        spent: true, // Spent UTXO should not count
      });

      const balanceResult = await repository.getBalanceByAddress("addr1");
      expect(balanceResult.isOk()).toBe(true);
      if (balanceResult.isOk()) {
        expect(balanceResult.value).toBe(80); // 50 + 30, excluding spent 20
      }
    });

    test("should mark UTXO as spent", async () => {
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const markResult = await repository.markAsSpent(
        padTxId("tx1"),
        0,
        padTxId("tx2")
      );
      expect(markResult.isOk()).toBe(true);

      // Verify UTXO is spent by checking balance (spent UTXOs don't appear in findByTxIdsAndVouts)
      const balanceResult = await repository.getBalanceByAddress("addr1");
      expect(balanceResult.isOk() && balanceResult.value).toBe(0);

      // Also verify via markAsSpent that it fails if we try to spend it again
      const markAgainResult = await repository.markAsSpent(
        padTxId("tx1"),
        0,
        padTxId("tx3")
      );
      expect(markAgainResult.isErr()).toBe(true);
    });

    test("should get max block height", async () => {
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 5,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx2"),
        vout: 0,
        address: "addr2",
        value: 50,
        scriptPubkey: "",
        blockHeight: 3,
        spent: false,
      });

      const maxHeightResult = await repository.getMaxBlockHeight();
      expect(maxHeightResult.isOk()).toBe(true);
      if (maxHeightResult.isOk()) {
        expect(maxHeightResult.value).toBe(5);
      }
    });
  });

  describe("Services with real repository", () => {
    test("BalanceService should work with real repository", async () => {
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const result = await balanceService.getBalance("addr1");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(100);
      }
    });

    test("BlockService should process blocks with real repository", async () => {
      // Insert initial UTXO
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      // Process a block that spends it
      const block = {
        id: "block_hash",
        height: 2,
        transactions: [
          {
            id: padTxId("tx2"),
            inputs: [{ txId: padTxId("tx1"), index: 0 }],
            outputs: [
              { address: "addr2", value: 60 },
              { address: "addr3", value: 40 },
            ],
          },
        ],
      };

      // Calculate correct block ID
      const txIds = block.transactions.map((tx) => tx.id).join("");
      const hashInput = `${block.height}${txIds}`;
      const crypto = require("crypto");
      block.id = crypto.createHash("sha256").update(hashInput).digest("hex");

      const result = await blockService.processBlock(block);
      expect(result.isOk()).toBe(true);

      // Verify balance changes
      const balance1Result = await balanceService.getBalance("addr1");
      const balance2Result = await balanceService.getBalance("addr2");
      const balance3Result = await balanceService.getBalance("addr3");

      expect(balance1Result.isOk() && balance1Result.value).toBe(0);
      expect(balance2Result.isOk() && balance2Result.value).toBe(60);
      expect(balance3Result.isOk() && balance3Result.value).toBe(40);
    });
  });
});
