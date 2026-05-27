-- 006_create_music_engagement_tables.sql
-- Persistencia de engagement de música (likes, dislikes, vistas únicas por hora)

CREATE TABLE IF NOT EXISTS music_track_stats (
  track_id uuid PRIMARY KEY REFERENCES musics(id) ON DELETE CASCADE,
  likes bigint NOT NULL DEFAULT 0,
  dislikes bigint NOT NULL DEFAULT 0,
  views bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS music_track_votes (
  track_id uuid NOT NULL REFERENCES musics(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  vote text NOT NULL CHECK (vote IN ('like', 'dislike')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track_id, viewer_key)
);

CREATE TABLE IF NOT EXISTS music_track_views_hourly (
  track_id uuid NOT NULL REFERENCES musics(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  hour_bucket timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track_id, viewer_key, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_music_track_votes_track ON music_track_votes(track_id);
CREATE INDEX IF NOT EXISTS idx_music_track_views_hourly_track ON music_track_views_hourly(track_id);
CREATE INDEX IF NOT EXISTS idx_music_track_views_hourly_bucket ON music_track_views_hourly(hour_bucket);
