import { ErrorFactory } from "@praha/error-factory";

export class InvalidBlockHeightError extends ErrorFactory({
  name: "InvalidBlockHeight",
  message:
    "Block height must be exactly one unit higher than the current height",
  fields: ErrorFactory.fields<{
    statusCode: number;
    currentHeight?: number;
    height?: number;
  }>(),
}) {}

export class InvalidInputOutputSumError extends ErrorFactory({
  name: "InvalidInputOutputSum",
  message: "Sum of input values must equal sum of output values",
  fields: ErrorFactory.fields<{ statusCode: number }>(),
}) {}

export class InvalidBlockIdError extends ErrorFactory({
  name: "InvalidBlockId",
  message: "Block ID is invalid",
  fields: ErrorFactory.fields<{ statusCode: number }>(),
}) {}

export class MutexTimeoutError extends ErrorFactory({
  name: "MutexTimeout",
  message: "Request timed out waiting for mutex",
  fields: ErrorFactory.fields<{ statusCode: number }>(),
}) {}

export class DatabaseError extends ErrorFactory({
  name: "DatabaseError",
  message: "Database operation failed",
  fields: ErrorFactory.fields<{ statusCode: number }>(),
}) {}

export class AddressNotFoundError extends ErrorFactory({
  name: "AddressNotFound",
  message: "Address not found",
  fields: ErrorFactory.fields<{ statusCode: number }>(),
}) {}

export class UTXONotFoundError extends ErrorFactory({
  name: "UTXONotFound",
  message: "UTXO not found",
  fields: ErrorFactory.fields<{ statusCode: number }>(),
}) {}

export class InvalidRollbackHeightError extends ErrorFactory({
  name: "InvalidRollbackHeight",
  message: "Invalid rollback height",
  fields: ErrorFactory.fields<{
    statusCode: number;
    targetHeight?: number;
    currentHeight?: number;
  }>(),
}) {}

export class NoBlocksToRollbackError extends ErrorFactory({
  name: "NoBlocksToRollback",
  message: "No blocks exist to rollback",
  fields: ErrorFactory.fields<{
    statusCode: number;
    targetHeight: number;
    currentHeight: number;
  }>(),
}) {}

export type AppError =
  | InvalidBlockHeightError
  | InvalidInputOutputSumError
  | InvalidBlockIdError
  | MutexTimeoutError
  | DatabaseError
  | AddressNotFoundError
  | UTXONotFoundError
  | InvalidRollbackHeightError
  | NoBlocksToRollbackError;

export function getErrorStatusCode(error: AppError): number {
  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }

  const statusCodeMap: Record<string, number> = {
    InvalidBlockHeight: 400,
    InvalidInputOutputSum: 400,
    InvalidBlockId: 400,
    MutexTimeout: 408,
    DatabaseError: 500,
    AddressNotFound: 404,
    UTXONotFound: 404,
    InvalidRollbackHeight: 400,
    NoBlocksToRollback: 400,
  };

  return statusCodeMap[error.name] || 500;
}
