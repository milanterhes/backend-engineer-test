import { createHash } from "crypto";
import { inject, injectable } from "inversify";
import { Result, err, ok } from "neverthrow";
import "reflect-metadata";
import {
  DatabaseError,
  InvalidBlockHeightError,
  InvalidBlockIdError,
  InvalidInputOutputSumError,
  UTXONotFoundError,
} from "../errors";
import type { IUTXORepository } from "../repositories/utxo.repository";
import type { Block } from "../types/block.types";
import { TYPES } from "../types/di.types";

@injectable()
export class BlockService {
  constructor(
    @inject(TYPES.IUTXORepository) private repository: IUTXORepository
  ) {}

  async processBlock(
    block: Block
  ): Promise<
    Result<
      void,
      | InvalidBlockHeightError
      | InvalidInputOutputSumError
      | InvalidBlockIdError
      | DatabaseError
      | UTXONotFoundError
    >
  > {
    try {
      // Validate height
      const heightResult = await this.validateHeight(block.height);
      if (heightResult.isErr()) {
        return err(heightResult.error);
      }

      // Validate input/output sum equality
      const sumResult = await this.validateInputOutputSum(block);
      if (sumResult.isErr()) {
        return err(sumResult.error);
      }

      // Validate block ID
      const blockIdResult = this.validateBlockId(block);
      if (blockIdResult.isErr()) {
        return err(blockIdResult.error);
      }

      // Process transactions
      for (const transaction of block.transactions) {
        // Mark inputs as spent (skip coinbase inputs)
        for (const input of transaction.inputs) {
          // Skip coinbase inputs - they don't reference real UTXOs
          if (this.isCoinbaseInput(input.txId)) {
            continue;
          }

          const updateResult = await this.repository.markAsSpent(
            input.txId,
            input.index,
            transaction.id
          );
          if (updateResult.isErr()) {
            return err(updateResult.error);
          }
        }

        // Create new outputs
        for (let i = 0; i < transaction.outputs.length; i++) {
          const output = transaction.outputs[i];
          const insertResult = await this.repository.insert({
            txid: transaction.id,
            vout: i,
            address: output.address,
            value: output.value,
            scriptPubkey: "",
            blockHeight: block.height,
            spent: false,
          });

          if (insertResult.isErr()) {
            return err(insertResult.error);
          }
        }
      }

      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  private async validateHeight(
    height: number
  ): Promise<Result<void, InvalidBlockHeightError>> {
    const maxHeightResult = await this.repository.getMaxBlockHeight();
    if (maxHeightResult.isErr()) {
      return err(new InvalidBlockHeightError({ statusCode: 400 }));
    }

    const expectedHeight = maxHeightResult.value + 1;
    if (height !== expectedHeight) {
      return err(
        new InvalidBlockHeightError({
          statusCode: 400,
          currentHeight: maxHeightResult.value,
          height,
        })
      );
    }

    return ok(undefined);
  }

  /**
   * Determines if a transaction input is a coinbase input.
   *
   * In blockchain systems, coinbase transactions are special transactions that create new coins
   * as a reward for miners. These transactions don't reference previous UTXOs (Unspent Transaction Outputs)
   * because they're creating new coins rather than spending existing ones.
   *
   * Coinbase inputs are conventionally represented by a transaction ID consisting entirely of zeros
   * (e.g., "0000000000000000000000000000000000000000000000000000000000000000").
   *
   * @param txId - The transaction ID to check
   * @returns true if the transaction ID consists entirely of zeros (coinbase input), false otherwise
   */
  private isCoinbaseInput(txId: string): boolean {
    // Check if the transaction ID consists entirely of zeros
    // Regex explanation: ^ = start, 0+ = one or more zeros, $ = end
    // This matches strings like "0", "00", "0000", etc. but not "0x0" or empty strings
    return /^0+$/.test(txId);
  }

  private async validateInputOutputSum(
    block: Block
  ): Promise<Result<void, InvalidInputOutputSumError>> {
    // Validate coinbase transactions and transactions with no inputs
    const coinbaseResult = this.validateCoinbaseTransactions(
      block.transactions
    );
    if (coinbaseResult.isErr()) {
      return err(coinbaseResult.error);
    }

    // Validate regular transactions that reference UTXOs
    const regularResult = await this.validateRegularTransactions(
      block.transactions
    );
    if (regularResult.isErr()) {
      return err(regularResult.error);
    }

    return ok(undefined);
  }

  /**
   * Validates coinbase transactions and transactions with no inputs.
   * - Coinbase transactions can have any output sum (they create new coins)
   * - Transactions with no inputs must have output sum of 0
   * - Transactions cannot mix coinbase and regular inputs
   */
  private validateCoinbaseTransactions(
    transactions: Block["transactions"]
  ): Result<void, InvalidInputOutputSumError> {
    for (const transaction of transactions) {
      const hasCoinbaseInputs = transaction.inputs.some((input) =>
        this.isCoinbaseInput(input.txId)
      );
      const hasRegularInputs = transaction.inputs.some(
        (input) => !this.isCoinbaseInput(input.txId)
      );

      // Transactions cannot mix coinbase and regular inputs
      if (hasCoinbaseInputs && hasRegularInputs) {
        return err(new InvalidInputOutputSumError({ statusCode: 400 }));
      }

      // Coinbase transactions create new coins, so output sum can be any value
      if (hasCoinbaseInputs) {
        continue;
      }

      // Transactions with no inputs must have output sum of 0
      if (transaction.inputs.length === 0) {
        const outputSum = transaction.outputs.reduce(
          (sum, out) => sum + out.value,
          0
        );
        if (outputSum !== 0) {
          return err(new InvalidInputOutputSumError({ statusCode: 400 }));
        }
      }
    }

    return ok(undefined);
  }

  /**
   * Validates regular transactions that reference UTXOs.
   * For each transaction, ensures that the sum of input values equals the sum of output values.
   */
  private async validateRegularTransactions(
    transactions: Block["transactions"]
  ): Promise<Result<void, InvalidInputOutputSumError>> {
    // Filter to only regular transactions (non-coinbase, with inputs)
    const regularTransactions = transactions.filter((tx) => {
      const hasCoinbaseInputs = tx.inputs.some((input) =>
        this.isCoinbaseInput(input.txId)
      );
      return !hasCoinbaseInputs && tx.inputs.length > 0;
    });

    // If there are no regular transactions, we're done
    if (regularTransactions.length === 0) {
      return ok(undefined);
    }

    // Collect all input references for UTXO lookup
    const inputRefs: Array<{ txId: string; vout: number }> =
      regularTransactions.flatMap((tx) =>
        tx.inputs.map((input) => ({ txId: input.txId, vout: input.index }))
      );

    // Fetch UTXOs
    const utxosResult = await this.repository.findByTxIdsAndVouts(inputRefs);
    if (utxosResult.isErr()) {
      return err(new InvalidInputOutputSumError({ statusCode: 400 }));
    }

    // Build UTXO map for quick lookup
    const utxos = utxosResult.value;
    const utxoMap = new Map<string, (typeof utxos)[0]>();
    for (const utxo of utxos) {
      const key = `${utxo.txid}:${utxo.vout}`;
      utxoMap.set(key, utxo);
    }

    // Validate input/output sum equality for each regular transaction
    for (const transaction of regularTransactions) {
      const outputSum = transaction.outputs.reduce(
        (sum, out) => sum + out.value,
        0
      );

      let inputSum = 0;
      for (const input of transaction.inputs) {
        const key = `${input.txId}:${input.index}`;
        const utxo = utxoMap.get(key);

        if (!utxo) {
          return err(new InvalidInputOutputSumError({ statusCode: 400 }));
        }

        inputSum += Number(utxo.value);
      }

      if (inputSum !== outputSum) {
        return err(new InvalidInputOutputSumError({ statusCode: 400 }));
      }
    }

    return ok(undefined);
  }

  private padTxId(txId: string): string {
    // Pad transaction ID to 64 characters (required by database schema)
    return txId.padEnd(64, "0").substring(0, 64);
  }

  private validateBlockId(block: Block): Result<void, InvalidBlockIdError> {
    // Concatenate transaction IDs in order (height + transaction1.id + transaction2.id + ...)
    // Pad transaction IDs to 64 characters before hashing (matching database schema)
    const txIds = block.transactions.map((tx) => this.padTxId(tx.id)).join("");
    const hashInput = `${block.height}${txIds}`;
    const expectedHash = createHash("sha256").update(hashInput).digest("hex");

    if (block.id !== expectedHash) {
      return err(new InvalidBlockIdError({ statusCode: 400 }));
    }

    return ok(undefined);
  }
}
