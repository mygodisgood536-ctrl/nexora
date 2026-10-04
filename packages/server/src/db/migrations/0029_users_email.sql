-- Worker email contact (Part 1 §12 worker profile).
-- Migration 0004 defined phone / passport_photo_url / birth_day / birth_month
-- on users but omitted the worker email field; this adds it for profile and
-- notification workflows. No other columns are touched.
ALTER TABLE users
  ADD COLUMN email text;