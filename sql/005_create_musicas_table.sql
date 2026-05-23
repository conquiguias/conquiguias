-- 005_create_musicas_table.sql
-- Tabla para almacenar metadatos de músicas/videos en Supabase (Postgres)
-- Ejecutar en la DB de Supabase (ajusta funciones uuid según configuración)

-- Habilitar extensión para gen_random_uuid si no está disponible
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS musics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text REFERENCES usuarios(uid) ON DELETE SET NULL,
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
  owner_id text REFERENCES usuarios(uid) ON DELETE CASCADE,
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

-- Nota: restricciones como "max 3 playlists por usuario" o "max 20 items por playlist"
-- deben aplicarse en la capa de aplicación o mediante triggers personalizados.
