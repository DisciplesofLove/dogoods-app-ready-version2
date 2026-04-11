-- Emergency food requests table
-- Tracks urgent food assistance requests from users
CREATE TABLE IF NOT EXISTS emergency_food_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    urgency_level TEXT NOT NULL CHECK (urgency_level IN ('critical', 'high', 'moderate')),
    family_size INT NOT NULL DEFAULT 1 CHECK (family_size >= 1 AND family_size <= 20),
    dietary_needs TEXT[] DEFAULT '{}',
    message TEXT DEFAULT '',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'in_progress', 'completed', 'cancelled')),
    matched_donor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    matched_listing_id UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_emergency_requests_status ON emergency_food_requests(status);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_user ON emergency_food_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_urgency ON emergency_food_requests(urgency_level, status);
CREATE INDEX IF NOT EXISTS idx_emergency_requests_location ON emergency_food_requests(latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emergency_requests_created ON emergency_food_requests(created_at DESC);

-- RLS policies
ALTER TABLE emergency_food_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own requests
CREATE POLICY "Users can view own emergency requests"
    ON emergency_food_requests FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create their own requests
CREATE POLICY "Users can create emergency requests"
    ON emergency_food_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own requests
CREATE POLICY "Users can update own emergency requests"
    ON emergency_food_requests FOR UPDATE
    USING (auth.uid() = user_id);

-- Service role can do everything (for backend API)
CREATE POLICY "Service role full access to emergency requests"
    ON emergency_food_requests
    USING (auth.role() = 'service_role');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_emergency_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_emergency_requests_updated_at
    BEFORE UPDATE ON emergency_food_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_emergency_requests_updated_at();
