import "reflect-metadata";
import { injectable } from "inversify";
import { Mutex, withTimeout } from "async-mutex";
import { ResultAsync } from "neverthrow";
import { MutexTimeoutError } from "../errors";

@injectable()
export class MutexService {
  private mutex: Mutex;

  constructor() {
    this.mutex = new Mutex();
  }

  async acquireWithTimeout(timeoutMs: number) {
    return ResultAsync.fromPromise(
      withTimeout(this.mutex, timeoutMs).acquire(),
      () => new MutexTimeoutError({ statusCode: 408 })
    );
  }
}
