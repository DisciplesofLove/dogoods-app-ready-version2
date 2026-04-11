-- ============================================================
-- Community Resources Table — food banks, pantries, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS community_resources (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'food_bank',  -- food_bank, pantry, snap_office, wic_office, soup_kitchen, shelter, other
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    phone TEXT,
    hours_json JSONB,        -- e.g. {"mon": "9am-5pm", "tue": "9am-5pm", ...}
    services TEXT,            -- free-text description of services
    website TEXT,
    verified BOOLEAN DEFAULT false,
    last_updated TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Index for location-based queries
CREATE INDEX IF NOT EXISTS idx_community_resources_location
    ON community_resources (latitude, longitude)
    WHERE verified = true;

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_community_resources_type
    ON community_resources (type)
    WHERE verified = true;

-- RLS policies
ALTER TABLE community_resources ENABLE ROW LEVEL SECURITY;

-- Anyone can read verified resources
CREATE POLICY "Public can read verified community resources"
    ON community_resources FOR SELECT
    USING (verified = true);

-- Authenticated users can insert (admin verifies later)
CREATE POLICY "Authenticated users can insert community resources"
    ON community_resources FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Admins can update/delete
CREATE POLICY "Admins can update community resources"
    ON community_resources FOR UPDATE
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)
    );

CREATE POLICY "Admins can delete community resources"
    ON community_resources FOR DELETE
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)
    );
