-- Add quantity column to food_claims to track how many units were claimed
ALTER TABLE food_claims
ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;