import "reflect-metadata";

export const TYPES = {
  IUTXORepository: Symbol.for("IUTXORepository"),
  BalanceService: Symbol.for("BalanceService"),
  BlockService: Symbol.for("BlockService"),
  MutexService: Symbol.for("MutexService"),
  RollbackService: Symbol.for("RollbackService"),
} as const;

