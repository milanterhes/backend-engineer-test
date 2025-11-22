import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const utxos = pgTable(
  "utxos",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    txid: char("txid", { length: 64 }).notNull(),
    vout: integer("vout").notNull(),
    address: varchar("address", { length: 64 }).notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    scriptPubkey: text("script_pubkey").notNull(),
    blockHeight: integer("block_height").notNull(),
    spent: boolean("spent").default(false).notNull(),
    spentTxid: char("spent_txid", { length: 64 }),
    spentAt: timestamp("spent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("utxos_txid_vout_unique").on(table.txid, table.vout),
    index("idx_utxo_address_unspent")
      .on(table.address)
      .where(sql`${table.spent} = FALSE`),
    index("idx_utxo_spent").on(table.spent, table.address),
    index("idx_utxo_txid_vout").on(table.txid, table.vout),
    index("idx_utxo_block_height").on(table.blockHeight),
  ]
);

export type UTXO = typeof utxos.$inferSelect;
export type NewUTXO = typeof utxos.$inferInsert;
