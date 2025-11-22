CREATE TABLE "utxos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"txid" char(64) NOT NULL,
	"vout" integer NOT NULL,
	"address" varchar(64) NOT NULL,
	"value" bigint NOT NULL,
	"script_pubkey" text NOT NULL,
	"block_height" integer NOT NULL,
	"spent" boolean DEFAULT false NOT NULL,
	"spent_txid" char(64),
	"spent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "utxos_txid_vout_unique" ON "utxos" USING btree ("txid","vout");--> statement-breakpoint
CREATE INDEX "idx_utxo_address_unspent" ON "utxos" USING btree ("address") WHERE "utxos"."spent" = FALSE;--> statement-breakpoint
CREATE INDEX "idx_utxo_spent" ON "utxos" USING btree ("spent","address");--> statement-breakpoint
CREATE INDEX "idx_utxo_txid_vout" ON "utxos" USING btree ("txid","vout");--> statement-breakpoint
CREATE INDEX "idx_utxo_block_height" ON "utxos" USING btree ("block_height");