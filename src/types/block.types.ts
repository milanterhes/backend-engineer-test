import { z } from 'zod';

export const OutputSchema = z.object({
  address: z.string(),
  value: z.number(),
});

export const InputSchema = z.object({
  txId: z.string(),
  index: z.number(),
});

export const TransactionSchema = z.object({
  id: z.string(),
  inputs: z.array(InputSchema),
  outputs: z.array(OutputSchema),
});

export const BlockSchema = z.object({
  id: z.string(),
  height: z.number(),
  transactions: z.array(TransactionSchema),
});

export type Output = z.infer<typeof OutputSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type Block = z.infer<typeof BlockSchema>;

