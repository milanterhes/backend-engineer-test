import "reflect-metadata";
import { inject, injectable } from "inversify";
import { Result } from "neverthrow";
import { DatabaseError } from "../errors";
import { TYPES } from "../types/di.types";
import type { IUTXORepository } from "../repositories/utxo.repository";

@injectable()
export class BalanceService {
  constructor(
    @inject(TYPES.IUTXORepository) private repository: IUTXORepository
  ) {}

  async getBalance(
    address: string
  ): Promise<Result<number, DatabaseError>> {
    return this.repository.getBalanceByAddress(address);
  }
}
