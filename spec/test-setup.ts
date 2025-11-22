import { Container } from "inversify";
import "reflect-metadata";
import { getDb } from "../src/db";
import type { IUTXORepository } from "../src/repositories/utxo.repository";
import { UTXORepository } from "../src/repositories/utxo.repository.impl";
import { BalanceService } from "../src/services/balance.service";
import { BlockService } from "../src/services/block.service";
import { MutexService } from "../src/services/mutex.service";
import { RollbackService } from "../src/services/rollback.service";
import { TYPES } from "../src/types/di.types";
import { InMemoryUTXORepository } from "./repositories/in-memory-utxo.repository";

/**
 * Creates a test container with in-memory repository
 * Use this for unit tests that don't need a real database
 * Should be called in beforeEach hook
 */
export function createTestContainer(): Container {
  const container = new Container();

  // Bind in-memory repository as singleton
  container
    .bind<IUTXORepository>(TYPES.IUTXORepository)
    .to(InMemoryUTXORepository)
    .inSingletonScope();

  // Bind services as transient
  container
    .bind<BalanceService>(TYPES.BalanceService)
    .to(BalanceService)
    .inTransientScope();

  container
    .bind<BlockService>(TYPES.BlockService)
    .to(BlockService)
    .inTransientScope();

  container
    .bind<MutexService>(TYPES.MutexService)
    .to(MutexService)
    .inSingletonScope();

  container
    .bind<RollbackService>(TYPES.RollbackService)
    .to(RollbackService)
    .inTransientScope();

  return container;
}

/**
 * Creates a test container with real database repository
 * Use this for integration tests that verify the repository implementation
 * Database must be initialized before calling this
 */
export function createIntegrationTestContainer(): Container {
  const container = new Container();
  const db = getDb();
  const repository = new UTXORepository(db);

  // Bind real repository as singleton (toConstantValue is already singleton)
  container
    .bind<IUTXORepository>(TYPES.IUTXORepository)
    .toConstantValue(repository);

  // Bind services as transient
  container
    .bind<BalanceService>(TYPES.BalanceService)
    .to(BalanceService)
    .inTransientScope();

  container
    .bind<BlockService>(TYPES.BlockService)
    .to(BlockService)
    .inTransientScope();

  container
    .bind<MutexService>(TYPES.MutexService)
    .to(MutexService)
    .inSingletonScope();

  container
    .bind<RollbackService>(TYPES.RollbackService)
    .to(RollbackService)
    .inTransientScope();

  return container;
}

/**
 * Helper function to pad transaction ID to 64 characters (required by schema)
 */
export function padTxId(txid: string): string {
  return txid.padEnd(64, "0").substring(0, 64);
}
