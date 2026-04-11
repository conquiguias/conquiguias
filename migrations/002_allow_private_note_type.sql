-- Normalize user_notes.note_type to 'private' only
-- Run this in Supabase SQL Editor

DO $$
BEGIN
  IF to_regclass('public.user_notes') IS NULL THEN
    CREATE TABLE public.user_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      note_type TEXT NOT NULL DEFAULT 'private' CHECK (note_type = 'private'),
      title TEXT NOT NULL DEFAULT 'Sin título',
      html TEXT NOT NULL DEFAULT '',
      zoom INTEGER NOT NULL DEFAULT 100 CHECK (zoom >= 50 AND zoom <= 300),
      wrap BOOLEAN NOT NULL DEFAULT true,
      tab_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT
    );

    CREATE INDEX IF NOT EXISTS user_notes_user_type_order_idx
      ON public.user_notes(user_id, note_type, tab_order);

    CREATE INDEX IF NOT EXISTS user_notes_user_type_idx
      ON public.user_notes(user_id, note_type);

    RETURN;
  END IF;

  -- Convert any legacy values before tightening the constraint
  UPDATE public.user_notes
  SET note_type = 'private'
  WHERE note_type IS DISTINCT FROM 'private';

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_notes_note_type_check'
      AND conrelid = 'public.user_notes'::regclass
  ) THEN
    ALTER TABLE public.user_notes
      DROP CONSTRAINT user_notes_note_type_check;
  END IF;

  ALTER TABLE public.user_notes
    ADD CONSTRAINT user_notes_note_type_check
    CHECK (note_type = 'private');

  ALTER TABLE public.user_notes
    ALTER COLUMN note_type SET DEFAULT 'private';
END
$$;

SELECT 'user_notes note_type constraint updated: private' AS status;
