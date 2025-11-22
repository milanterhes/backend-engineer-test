import { beforeEach, describe, expect, test } from "bun:test";
import { Container } from "inversify";
import "reflect-metadata";
import {
  InvalidRollbackHeightError,
  NoBlocksToRollbackError,
} from "../../src/errors";
import { RollbackService } from "../../src/services/rollback.service";
import { TYPES } from "../../src/types/di.types";
import { InMemoryUTXORepository } from "../repositories/in-memory-utxo.repository";
import { createTestContainer, padTxId } from "../test-setup";

describe("RollbackService", () => {
  let container: Container;
  let rollbackService: RollbackService;
  let repository: InMemoryUTXORepository;

  beforeEach(() => {
    container = createTestContainer();
    rollbackService = container.get<RollbackService>(TYPES.RollbackService);
    repository = container.get<InMemoryUTXORepository>(
      TYPES.IUTXORepository
    ) as InMemoryUTXORepository;
    repository.clearAll();
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
      // Insert some UTXOs at height 1
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const result = await rollbackService.rollbackToHeight(5);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidRollbackHeightError);
      }
    });

    test("should return error when target height equals current height", async () => {
      // Insert some UTXOs at height 1
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const result = await rollbackService.rollbackToHeight(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(NoBlocksToRollbackError);
        expect(result.error.statusCode).toBe(400);
        if (result.error instanceof NoBlocksToRollbackError) {
          expect(result.error.targetHeight).toBe(1);
          expect(result.error.currentHeight).toBe(1);
        }
      }
    });

    test("should return error when target height is 0 and no UTXOs exist", async () => {
      const result = await rollbackService.rollbackToHeight(0);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(NoBlocksToRollbackError);
        expect(result.error.statusCode).toBe(400);
        if (result.error instanceof NoBlocksToRollbackError) {
          expect(result.error.targetHeight).toBe(0);
          expect(result.error.currentHeight).toBe(0);
        }
      }
    });
  });

  describe("rollbackToHeight - Rollback Logic", () => {
    test("should delete UTXOs created after target height", async () => {
      // Create UTXOs at different heights
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
        blockHeight: 2,
        spent: false,
      });

      await repository.insert({
        txid: padTxId("tx3"),
        vout: 0,
        address: "addr3",
        value: 25,
        scriptPubkey: "",
        blockHeight: 3,
        spent: false,
      });

      // Rollback to height 1
      const result = await rollbackService.rollbackToHeight(1);
      expect(result.isOk()).toBe(true);

      // Verify UTXOs at height 1 still exist
      const utxosAtHeight1 = await repository.findUTXOsByBlockHeight(0);
      expect(utxosAtHeight1.isOk()).toBe(true);
      if (utxosAtHeight1.isOk()) {
        const utxos = utxosAtHeight1.value.filter((u) => u.blockHeight === 1);
        expect(utxos.length).toBe(1);
        expect(utxos[0].txid).toBe(padTxId("tx1"));
      }

      // Verify UTXOs at heights 2 and 3 are deleted
      const utxosAfterHeight1 = await repository.findUTXOsByBlockHeight(1);
      expect(utxosAfterHeight1.isOk()).toBe(true);
      if (utxosAfterHeight1.isOk()) {
        expect(utxosAfterHeight1.value.length).toBe(0);
      }
    });

    test("should unmark UTXOs that were spent by transactions in rolled-back blocks", async () => {
      // Create a UTXO at height 1
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      // Mark it as spent by a transaction at height 2
      await repository.markAsSpent(padTxId("tx1"), 0, padTxId("tx2"));

      // Create UTXO from transaction at height 2
      await repository.insert({
        txid: padTxId("tx2"),
        vout: 0,
        address: "addr2",
        value: 100,
        scriptPubkey: "",
        blockHeight: 2,
        spent: false,
      });

      // Rollback to height 1
      const result = await rollbackService.rollbackToHeight(1);
      expect(result.isOk()).toBe(true);

      // Verify the UTXO is unmarked as spent
      const utxosResult = await repository.findByTxIdsAndVouts([
        { txId: padTxId("tx1"), vout: 0 },
      ]);
      expect(utxosResult.isOk()).toBe(true);
      if (utxosResult.isOk()) {
        expect(utxosResult.value.length).toBe(1);
        expect(utxosResult.value[0].spent).toBe(false);
        expect(utxosResult.value[0].spentTxid).toBeNull();
      }
    });

    test("should handle rollback scenario from README example", async () => {
      // Setup: Create UTXOs matching README example
      // Height 1: tx1 creates output to addr1 with value 10
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 10,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      // Height 2: tx2 spends tx1:0, creates outputs to addr2 (4) and addr3 (6)
      await repository.markAsSpent(padTxId("tx1"), 0, padTxId("tx2"));
      await repository.insert({
        txid: padTxId("tx2"),
        vout: 0,
        address: "addr2",
        value: 4,
        scriptPubkey: "",
        blockHeight: 2,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx2"),
        vout: 1,
        address: "addr3",
        value: 6,
        scriptPubkey: "",
        blockHeight: 2,
        spent: false,
      });

      // Height 3: tx3 spends tx2:1, creates outputs to addr4, addr5, addr6 (each 2)
      await repository.markAsSpent(padTxId("tx2"), 1, padTxId("tx3"));
      await repository.insert({
        txid: padTxId("tx3"),
        vout: 0,
        address: "addr4",
        value: 2,
        scriptPubkey: "",
        blockHeight: 3,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx3"),
        vout: 1,
        address: "addr5",
        value: 2,
        scriptPubkey: "",
        blockHeight: 3,
        spent: false,
      });
      await repository.insert({
        txid: padTxId("tx3"),
        vout: 2,
        address: "addr6",
        value: 2,
        scriptPubkey: "",
        blockHeight: 3,
        spent: false,
      });

      // Rollback to height 2
      const rollbackResult = await rollbackService.rollbackToHeight(2);
      expect(rollbackResult.isOk()).toBe(true);

      // Verify balances match expected state after rollback:
      // addr1: 0, addr2: 4, addr3: 6
      const balance1 = await repository.getBalanceByAddress("addr1");
      const balance2 = await repository.getBalanceByAddress("addr2");
      const balance3 = await repository.getBalanceByAddress("addr3");
      const balance4 = await repository.getBalanceByAddress("addr4");
      const balance5 = await repository.getBalanceByAddress("addr5");
      const balance6 = await repository.getBalanceByAddress("addr6");

      expect(balance1.isOk()).toBe(true);
      expect(balance2.isOk()).toBe(true);
      expect(balance3.isOk()).toBe(true);
      expect(balance4.isOk()).toBe(true);
      expect(balance5.isOk()).toBe(true);
      expect(balance6.isOk()).toBe(true);

      if (
        balance1.isOk() &&
        balance2.isOk() &&
        balance3.isOk() &&
        balance4.isOk() &&
        balance5.isOk() &&
        balance6.isOk()
      ) {
        expect(balance1.value).toBe(0); // tx1:0 was spent by tx2
        expect(balance2.value).toBe(4); // tx2:0
        expect(balance3.value).toBe(6); // tx2:1 (unspent after rollback)
        expect(balance4.value).toBe(0); // tx3 outputs deleted
        expect(balance5.value).toBe(0); // tx3 outputs deleted
        expect(balance6.value).toBe(0); // tx3 outputs deleted
      }
    });

    test("should return error when rollback requested but no UTXOs exist", async () => {
      const result = await rollbackService.rollbackToHeight(0);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(NoBlocksToRollbackError);
        expect(result.error.statusCode).toBe(400);
        if (result.error instanceof NoBlocksToRollbackError) {
          expect(result.error.targetHeight).toBe(0);
          expect(result.error.currentHeight).toBe(0);
        }
      }
    });

    test("should handle rollback when target height is 0", async () => {
      // Create UTXOs at height 1
      await repository.insert({
        txid: padTxId("tx1"),
        vout: 0,
        address: "addr1",
        value: 100,
        scriptPubkey: "",
        blockHeight: 1,
        spent: false,
      });

      const result = await rollbackService.rollbackToHeight(0);
      expect(result.isOk()).toBe(true);

      // Verify all UTXOs are deleted
      const maxHeightResult = await repository.getMaxBlockHeight();
      expect(maxHeightResult.isOk()).toBe(true);
      if (maxHeightResult.isOk()) {
        expect(maxHeightResult.value).toBe(0);
      }
    });
  });
});
