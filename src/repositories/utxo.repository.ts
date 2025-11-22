import { Result } from "neverthrow";
import type { NewUTXO, UTXO } from "../db/schema";
import { DatabaseError, UTXONotFoundError } from "../errors";

export interface IUTXORepository {
  /**
   * Get the sum of all unspent UTXOs for an address
   */
  getBalanceByAddress(address: string): Promise<Result<number, DatabaseError>>;

  /**
   * Find multiple UTXOs by their transaction IDs and output indices
   */
  findByTxIdsAndVouts(
    refs: Array<{ txId: string; vout: number }>
  ): Promise<Result<UTXO[], DatabaseError>>;

  /**
   * Insert a new UTXO
   */
  insert(utxo: NewUTXO): Promise<Result<void, DatabaseError>>;

  /**
   * Mark a UTXO as spent
   */
  markAsSpent(
    txId: string,
    vout: number,
    spentTxid: string
  ): Promise<Result<void, UTXONotFoundError | DatabaseError>>;

  /**
   * Get the maximum block height from all UTXOs
   */
  getMaxBlockHeight(): Promise<Result<number, DatabaseError>>;

  /**
   * Find all UTXOs created at or above a given block height
   */
  findUTXOsByBlockHeight(
    minHeight: number
  ): Promise<Result<UTXO[], DatabaseError>>;

  /**
   * Unmark UTXOs that were spent by given transaction IDs
   */
  unmarkAsSpent(txIds: string[]): Promise<Result<void, DatabaseError>>;

  /**
   * Delete all UTXOs created at or above a given block height
   */
  deleteUTXOsByBlockHeight(
    minHeight: number
  ): Promise<Result<void, DatabaseError>>;
}
