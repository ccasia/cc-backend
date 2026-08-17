CREATE OR REPLACE FUNCTION "prevent_xp_transaction_mutation"()
  RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'XpTransaction rows are immutable';
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS "XpTransaction_immutable" ON "XpTransaction";

  CREATE TRIGGER "XpTransaction_immutable"
  BEFORE UPDATE OR DELETE ON "XpTransaction"
  FOR EACH ROW EXECUTE FUNCTION "prevent_xp_transaction_mutation"();