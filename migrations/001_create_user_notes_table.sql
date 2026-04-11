-- Create user_notes table for director and conqui private notes
-- Run this in Supabase SQL Editor

-- First check if table exists before creating
CREATE TABLE IF NOT EXISTS public.user_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  note_type TEXT NOT NULL CHECK (note_type IN ('director', 'conqui')), -- 'director' or 'conqui'
  title TEXT NOT NULL DEFAULT 'Sin título',
  html TEXT NOT NULL DEFAULT '',
  zoom INTEGER NOT NULL DEFAULT 100 CHECK (zoom >= 50 AND zoom <= 300),
  wrap BOOLEAN NOT NULL DEFAULT true,
  tab_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS user_notes_user_type_order_idx 
  ON public.user_notes(user_id, note_type, tab_order);

CREATE INDEX IF NOT EXISTS user_notes_user_type_idx 
  ON public.user_notes(user_id, note_type);

-- Create composite unique constraint to prevent duplicate user+type+id combinations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_notes_composite_uniq'
      AND conrelid = 'public.user_notes'::regclass
  ) THEN
    ALTER TABLE public.user_notes
      ADD CONSTRAINT user_notes_composite_uniq
      UNIQUE (user_id, note_type, id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

-- Enable Row Level Security
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

-- Create RLS policies - Users can only see their own notes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notes'
      AND policyname = 'user_notes_select_policy'
  ) THEN
    CREATE POLICY user_notes_select_policy
      ON public.user_notes
      FOR SELECT
      USING (user_id = auth.uid()::text);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notes'
      AND policyname = 'user_notes_insert_policy'
  ) THEN
    CREATE POLICY user_notes_insert_policy
      ON public.user_notes
      FOR INSERT
      WITH CHECK (user_id = auth.uid()::text);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notes'
      AND policyname = 'user_notes_update_policy'
  ) THEN
    CREATE POLICY user_notes_update_policy
      ON public.user_notes
      FOR UPDATE
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notes'
      AND policyname = 'user_notes_delete_policy'
  ) THEN
    CREATE POLICY user_notes_delete_policy
      ON public.user_notes
      FOR DELETE
      USING (user_id = auth.uid()::text);
  END IF;
END
$$;

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notes TO authenticated;

-- Log completion
SELECT 'user_notes table created/verified successfully' AS status;
