CREATE TABLE IF NOT EXISTS platform.departments (
    name VARCHAR(100) PRIMARY KEY,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed existing departments from agent_definitions
INSERT INTO platform.departments (name)
SELECT DISTINCT department 
FROM platform.agent_definitions 
WHERE department IS NOT NULL
ON CONFLICT (name) DO NOTHING;

-- Add foreign key constraint to agent_definitions (CASCADE on update, RESTRICT on delete)
ALTER TABLE platform.agent_definitions
ADD CONSTRAINT fk_agent_department
FOREIGN KEY (department) 
REFERENCES platform.departments(name)
ON UPDATE CASCADE
ON DELETE RESTRICT;
