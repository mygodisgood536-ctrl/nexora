BEGIN;

DROP INDEX IF EXISTS uq_face_captures_app;
DROP INDEX IF EXISTS uq_face_captures_customer_sequence;

CREATE UNIQUE INDEX IF NOT EXISTS uq_face_captures_customer_party_sequence
  ON face_captures (customer_id, capture_for, party, capture_sequence);

CREATE UNIQUE INDEX IF NOT EXISTS uq_face_captures_application_party_sequence
  ON face_captures (loan_application_id, party, capture_sequence)
  WHERE loan_application_id IS NOT NULL;

COMMIT;
