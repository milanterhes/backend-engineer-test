import { injectable } from "inversify";
import { Result, err, ok } from "neverthrow";
import "reflect-metadata";
import type { NewUTXO, UTXO } from "../../src/db/schema";
import { DatabaseError, UTXONotFoundError } from "../../src/errors";
import type { IUTXORepository } from "../../src/repositories/utxo.repository";

@injectable()
export class InMemoryUTXORepository implements IUTXORepository {
  private utxos: Map<string, UTXO> = new Map();
  private nextId = 1n;

  private getKey(txId: string, vout: number): string {
    return `${txId}:${vout}`;
  }

  async getBalanceByAddress(
    address: string
  ): Promise<Result<number, DatabaseError>> {
    try {
      let total = 0;
      for (const utxo of this.utxos.values()) {
        if (utxo.address === address && !utxo.spent) {
          total += Number(utxo.value);
        }
      }
      return ok(total);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async findByTxIdsAndVouts(
    refs: Array<{ txId: string; vout: number }>
  ): Promise<Result<UTXO[], DatabaseError>> {
    try {
      const results: UTXO[] = [];
      for (const ref of refs) {
        const key = this.getKey(ref.txId, ref.vout);
        const utxo = this.utxos.get(key);
        if (utxo && !utxo.spent) {
          results.push(utxo);
        }
      }
      return ok(results);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async insert(utxo: NewUTXO): Promise<Result<void, DatabaseError>> {
    try {
      const key = this.getKey(utxo.txid, utxo.vout);
      const fullUtxo: UTXO = {
        id: this.nextId++,
        ...utxo,
        spent: utxo.spent ?? false,
        createdAt: utxo.createdAt || new Date(),
      } as UTXO;

      this.utxos.set(key, fullUtxo);
      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async markAsSpent(
    txId: string,
    vout: number,
    spentTxid: string
  ): Promise<Result<void, UTXONotFoundError | DatabaseError>> {
    try {
      const key = this.getKey(txId, vout);
      const utxo = this.utxos.get(key);

      if (!utxo || utxo.spent) {
        return err(new UTXONotFoundError({ statusCode: 404 }));
      }

      const updated: UTXO = {
        ...utxo,
        spent: true,
        spentTxid,
        spentAt: new Date(),
      };

      this.utxos.set(key, updated);
      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async getMaxBlockHeight(): Promise<Result<number, DatabaseError>> {
    try {
      let maxHeight = 0;
      for (const utxo of this.utxos.values()) {
        if (utxo.blockHeight > maxHeight) {
          maxHeight = utxo.blockHeight;
        }
      }
      return ok(maxHeight);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async findUTXOsByBlockHeight(
    minHeight: number
  ): Promise<Result<UTXO[], DatabaseError>> {
    try {
      const results: UTXO[] = [];
      for (const utxo of this.utxos.values()) {
        if (utxo.blockHeight > minHeight) {
          results.push(utxo);
        }
      }
      return ok(results);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async unmarkAsSpent(
    txIds: string[]
  ): Promise<Result<void, DatabaseError>> {
    try {
      const txIdSet = new Set(txIds);
      for (const [key, utxo] of this.utxos.entries()) {
        if (
          utxo.spent &&
          utxo.spentTxid &&
          txIdSet.has(utxo.spentTxid)
        ) {
          const updated: UTXO = {
            ...utxo,
            spent: false,
            spentTxid: null,
            spentAt: null,
          };
          this.utxos.set(key, updated);
        }
      }
      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async deleteUTXOsByBlockHeight(
    minHeight: number
  ): Promise<Result<void, DatabaseError>> {
    try {
      const keysToDelete: string[] = [];
      for (const [key, utxo] of this.utxos.entries()) {
        if (utxo.blockHeight > minHeight) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        this.utxos.delete(key);
      }
      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  /**
   * Test-only method to clear all UTXOs
   */
  clearAll(): void {
    this.utxos.clear();
    this.nextId = 1n;
  }
}
