-- 005_create_musicas_table.sql
-- Tabla para almacenar metadatos de músicas/videos en Supabase (Postgres)
-- Ejecutar en la DB de Supabase (ajusta funciones uuid según configuración)
-- owner_id guarda el UID de Firebase/Auth como texto (sin FK local)

-- Habilitar extensión para gen_random_uuid si no está disponible
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS musics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text,
  title text NOT NULL,
  url text NOT NULL,
  is_video boolean DEFAULT false,
  artist text,
  album text,
  year integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Playlists del usuario (límite de 3 por usuario debe aplicarse desde la API)
CREATE TABLE IF NOT EXISTS music_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Items de playlist (posición para ordenar)
CREATE TABLE IF NOT EXISTS music_playlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid REFERENCES music_playlists(id) ON DELETE CASCADE,
  music_id uuid REFERENCES musics(id) ON DELETE CASCADE,
  position integer DEFAULT 0
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_musics_owner ON musics(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlists_owner ON music_playlists(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON music_playlist_items(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_music ON music_playlist_items(music_id);

-- Nota: restricciones como "max 3 playlists por usuario" o "max 20 items por playlist"
-- deben aplicarse en la capa de aplicación o mediante triggers personalizados.

-- ==========================================
-- RLS (Row Level Security) para Supabase
-- ==========================================
-- IMPORTANTE:
-- - Si usas la service_role key desde backend (como en api/social.js),
--   RLS se omite para ese backend.
-- - Estas políticas aplican principalmente a acceso directo desde cliente Supabase.

ALTER TABLE musics ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_playlist_items ENABLE ROW LEVEL SECURITY;

-- Limpiar políticas previas (idempotente)
DROP POLICY IF EXISTS musics_select_all ON musics;
DROP POLICY IF EXISTS musics_insert_owner ON musics;
DROP POLICY IF EXISTS musics_update_owner ON musics;
DROP POLICY IF EXISTS musics_delete_owner ON musics;

DROP POLICY IF EXISTS playlists_select_owner ON music_playlists;
DROP POLICY IF EXISTS playlists_insert_owner ON music_playlists;
DROP POLICY IF EXISTS playlists_update_owner ON music_playlists;
DROP POLICY IF EXISTS playlists_delete_owner ON music_playlists;

DROP POLICY IF EXISTS playlist_items_select_owner ON music_playlist_items;
DROP POLICY IF EXISTS playlist_items_insert_owner ON music_playlist_items;
DROP POLICY IF EXISTS playlist_items_update_owner ON music_playlist_items;
DROP POLICY IF EXISTS playlist_items_delete_owner ON music_playlist_items;

-- musics: catálogo visible para lectura; escritura solo del propietario autenticado
CREATE POLICY musics_select_all
  ON musics FOR SELECT
  USING (true);

CREATE POLICY musics_insert_owner
  ON musics FOR INSERT
  WITH CHECK (owner_id = auth.uid()::text);

CREATE POLICY musics_update_owner
  ON musics FOR UPDATE
  USING (owner_id = auth.uid()::text)
  WITH CHECK (owner_id = auth.uid()::text);

CREATE POLICY musics_delete_owner
  ON musics FOR DELETE
  USING (owner_id = auth.uid()::text);

-- playlists: acceso solo del propietario
CREATE POLICY playlists_select_owner
  ON music_playlists FOR SELECT
  USING (owner_id = auth.uid()::text);

CREATE POLICY playlists_insert_owner
  ON music_playlists FOR INSERT
  WITH CHECK (owner_id = auth.uid()::text);

CREATE POLICY playlists_update_owner
  ON music_playlists FOR UPDATE
  USING (owner_id = auth.uid()::text)
  WITH CHECK (owner_id = auth.uid()::text);

CREATE POLICY playlists_delete_owner
  ON music_playlists FOR DELETE
  USING (owner_id = auth.uid()::text);

-- playlist_items: acceso si el usuario es dueño de la playlist relacionada
CREATE POLICY playlist_items_select_owner
  ON music_playlist_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM music_playlists p
      WHERE p.id = music_playlist_items.playlist_id
        AND p.owner_id = auth.uid()::text
    )
  );

CREATE POLICY playlist_items_insert_owner
  ON music_playlist_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM music_playlists p
      WHERE p.id = music_playlist_items.playlist_id
        AND p.owner_id = auth.uid()::text
    )
  );

CREATE POLICY playlist_items_update_owner
  ON music_playlist_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM music_playlists p
      WHERE p.id = music_playlist_items.playlist_id
        AND p.owner_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM music_playlists p
      WHERE p.id = music_playlist_items.playlist_id
        AND p.owner_id = auth.uid()::text
    )
  );

CREATE POLICY playlist_items_delete_owner
  ON music_playlist_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM music_playlists p
      WHERE p.id = music_playlist_items.playlist_id
        AND p.owner_id = auth.uid()::text
    )
  );
