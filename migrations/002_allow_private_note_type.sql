-- Normalize user_notes.note_type to 'private' only
-- Run this in Supabase SQL Editor

DO $$
BEGIN
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
END
$$;

SELECT 'user_notes note_type constraint updated: private' AS status;
