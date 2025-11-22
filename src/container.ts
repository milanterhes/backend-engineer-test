import "reflect-metadata";
import { Container } from "inversify";
import { getDb } from "./db";
import { UTXORepository } from "./repositories/utxo.repository.impl";
import { BalanceService } from "./services/balance.service";
import { BlockService } from "./services/block.service";
import { MutexService } from "./services/mutex.service";
import { RollbackService } from "./services/rollback.service";
import { TYPES } from "./types/di.types";
import type { IUTXORepository } from "./repositories/utxo.repository";

const container = new Container();

// Bind repository as singleton with database instance using factory
container
  .bind<IUTXORepository>(TYPES.IUTXORepository)
  .toDynamicValue(() => {
    const db = getDb();
    return new UTXORepository(db);
  })
  .inSingletonScope();

// Bind services as transient (new instance per request)
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
  .inSingletonScope(); // MutexService should be singleton to maintain mutex state

container
  .bind<RollbackService>(TYPES.RollbackService)
  .to(RollbackService)
  .inTransientScope();

export { container };

