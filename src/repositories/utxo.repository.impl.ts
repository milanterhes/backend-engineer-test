import { and, eq, gt, max, or, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";
import { injectable } from "inversify";
import { Result, err, ok } from "neverthrow";
import "reflect-metadata";
import type { NewUTXO, UTXO } from "../db/schema";
import { utxos } from "../db/schema";
import { DatabaseError, UTXONotFoundError } from "../errors";
import type { IUTXORepository } from "./utxo.repository";

@injectable()
export class UTXORepository implements IUTXORepository {
  constructor(private db: ReturnType<typeof drizzle>) {}

  async getBalanceByAddress(
    address: string
  ): Promise<Result<number, DatabaseError>> {
    try {
      const result = await this.db
        .select({
          total: sql<bigint>`COALESCE(SUM(${utxos.value}), 0)`,
        })
        .from(utxos)
        .where(and(eq(utxos.address, address), eq(utxos.spent, false)));

      const balance = result[0]?.total ? Number(result[0].total) : 0;
      return ok(balance);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async findByTxIdsAndVouts(
    refs: Array<{ txId: string; vout: number }>
  ): Promise<Result<UTXO[], DatabaseError>> {
    try {
      if (refs.length === 0) {
        return ok([]);
      }

      const result = await this.db
        .select()
        .from(utxos)
        .where(
          or(
            ...refs.map((ref) =>
              and(
                eq(utxos.txid, ref.txId),
                eq(utxos.vout, ref.vout),
                eq(utxos.spent, false)
              )
            )
          )
        );

      return ok(result);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async insert(utxo: NewUTXO): Promise<Result<void, DatabaseError>> {
    try {
      await this.db.insert(utxos).values(utxo);
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
      const utxoCheck = await this.db
        .select()
        .from(utxos)
        .where(and(eq(utxos.txid, txId), eq(utxos.vout, vout)))
        .limit(1);

      if (utxoCheck.length === 0 || utxoCheck[0].spent) {
        return err(new UTXONotFoundError({ statusCode: 404 }));
      }

      await this.db
        .update(utxos)
        .set({
          spent: true,
          spentTxid: spentTxid,
          spentAt: new Date(),
        })
        .where(and(eq(utxos.txid, txId), eq(utxos.vout, vout)));

      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async getMaxBlockHeight(): Promise<Result<number, DatabaseError>> {
    try {
      const result = await this.db
        .select({
          maxHeight: max(utxos.blockHeight),
        })
        .from(utxos);

      const currentMaxHeight = result[0]?.maxHeight ?? 0;
      return ok(Number(currentMaxHeight));
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async findUTXOsByBlockHeight(
    minHeight: number
  ): Promise<Result<UTXO[], DatabaseError>> {
    try {
      const result = await this.db
        .select()
        .from(utxos)
        .where(gt(utxos.blockHeight, minHeight));

      return ok(result);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async unmarkAsSpent(
    txIds: string[]
  ): Promise<Result<void, DatabaseError>> {
    try {
      if (txIds.length === 0) {
        return ok(undefined);
      }

      const conditions = txIds.map((txId) => eq(utxos.spentTxid, txId));
      const spentTxidCondition =
        conditions.length === 1 ? conditions[0] : or(...conditions);

      await this.db
        .update(utxos)
        .set({
          spent: false,
          spentTxid: null,
          spentAt: null,
        })
        .where(and(eq(utxos.spent, true), spentTxidCondition));

      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  async deleteUTXOsByBlockHeight(
    minHeight: number
  ): Promise<Result<void, DatabaseError>> {
    try {
      await this.db
        .delete(utxos)
        .where(gt(utxos.blockHeight, minHeight));

      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }
}
