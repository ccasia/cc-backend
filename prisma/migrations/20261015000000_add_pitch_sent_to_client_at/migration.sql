-- AlterTable
ALTER TABLE "Pitch" ADD COLUMN     "sentToClientAt" TIMESTAMP(3);

-- Stamp sentToClientAt whenever a pitch enters the client's queue, on every write
-- path (including statuses copied from other rows or passed in from requests).
-- Moving between the two waiting statuses keeps the original time. No backfill.
CREATE OR REPLACE FUNCTION "set_pitch_sent_to_client_at"()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('SENT_TO_CLIENT', 'AWAITING_APPROVAL') THEN
    IF TG_OP = 'INSERT' THEN
      NEW."sentToClientAt" := COALESCE(NEW."sentToClientAt", now());
    ELSIF OLD."status" IS NULL OR OLD."status" NOT IN ('SENT_TO_CLIENT', 'AWAITING_APPROVAL') THEN
      NEW."sentToClientAt" := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Pitch_set_sent_to_client_at"
BEFORE INSERT OR UPDATE OF "status" ON "Pitch"
FOR EACH ROW EXECUTE FUNCTION "set_pitch_sent_to_client_at"();
