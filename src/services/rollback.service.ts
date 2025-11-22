import { inject, injectable } from "inversify";
import { Result, err, ok } from "neverthrow";
import "reflect-metadata";
import {
  DatabaseError,
  InvalidRollbackHeightError,
  NoBlocksToRollbackError,
} from "../errors";
import type { IUTXORepository } from "../repositories/utxo.repository";
import { TYPES } from "../types/di.types";

@injectable()
export class RollbackService {
  constructor(
    @inject(TYPES.IUTXORepository) private repository: IUTXORepository
  ) {}

  async rollbackToHeight(
    targetHeight: number
  ): Promise<
    Result<
      void,
      InvalidRollbackHeightError | NoBlocksToRollbackError | DatabaseError
    >
  > {
    try {
      const validationResult = await this.validateRollbackHeight(targetHeight);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      const utxosResult = await this.repository.findUTXOsByBlockHeight(
        targetHeight
      );
      if (utxosResult.isErr()) {
        return err(utxosResult.error);
      }

      const utxosToDelete = utxosResult.value;

      // Check if there's actually anything to rollback
      if (utxosToDelete.length === 0) {
        const maxHeightResult = await this.repository.getMaxBlockHeight();
        if (maxHeightResult.isErr()) {
          return err(
            new InvalidRollbackHeightError({
              statusCode: 400,
              targetHeight,
            })
          );
        }

        const currentMaxHeight = maxHeightResult.value;

        return err(
          new NoBlocksToRollbackError({
            statusCode: 400,
            targetHeight,
            currentHeight: currentMaxHeight,
          })
        );
      }

      // Extract unique transaction IDs from UTXOs that will be deleted
      // These are the transaction IDs that created outputs in blocks to be rolled back
      const txIdsToRollback = new Set<string>();
      for (const utxo of utxosToDelete) {
        txIdsToRollback.add(utxo.txid);
      }

      // Unmark UTXOs that were spent by transactions in rolled-back blocks
      if (txIdsToRollback.size > 0) {
        const unmarkResult = await this.repository.unmarkAsSpent(
          Array.from(txIdsToRollback)
        );
        if (unmarkResult.isErr()) {
          return err(unmarkResult.error);
        }
      }

      const deleteResult = await this.repository.deleteUTXOsByBlockHeight(
        targetHeight
      );
      if (deleteResult.isErr()) {
        return err(deleteResult.error);
      }

      return ok(undefined);
    } catch (error) {
      return err(new DatabaseError({ statusCode: 500, cause: error }));
    }
  }

  private async validateRollbackHeight(
    targetHeight: number
  ): Promise<Result<void, InvalidRollbackHeightError>> {
    // Validate height is not negative
    if (targetHeight < 0) {
      return err(
        new InvalidRollbackHeightError({
          statusCode: 400,
          targetHeight,
        })
      );
    }

    const maxHeightResult = await this.repository.getMaxBlockHeight();
    if (maxHeightResult.isErr()) {
      return err(
        new InvalidRollbackHeightError({
          statusCode: 400,
          targetHeight,
        })
      );
    }

    const currentMaxHeight = maxHeightResult.value;

    if (targetHeight > currentMaxHeight) {
      return err(
        new InvalidRollbackHeightError({
          statusCode: 400,
          targetHeight,
          currentHeight: currentMaxHeight,
        })
      );
    }

    return ok(undefined);
  }
}
