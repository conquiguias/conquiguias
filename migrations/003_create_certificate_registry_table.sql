-- Conquiguias | Certificate Registry Table (Supabase)
-- Run this in Supabase SQL Editor
-- This table stores all certificate registrations with unique 9-digit codes
-- Structure: One row per specialty (nombre_especialidad) with all users in usuarios JSONB array

CREATE TABLE IF NOT EXISTS public.especialidades_registradas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_especialidad TEXT NOT NULL UNIQUE,
    fecha_especialidad TIMESTAMP,
    usuarios JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Legacy fields (for backward compatibility)
    nombre_usuario TEXT,
    nombre_instructor TEXT,
    correo_electronico TEXT,
    codigo_9digitos VARCHAR(9),
    nota_tarea DECIMAL(10, 2),
    nota_examen DECIMAL(10, 2),
    calificaciones JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_especialidades_registradas_especialidad 
ON public.especialidades_registradas(nombre_especialidad);

-- GIN index for searching within usuarios array (for queries on JSONB)
CREATE INDEX idx_especialidades_registradas_usuarios_gin 
ON public.especialidades_registradas USING GIN (usuarios);

CREATE INDEX idx_especialidades_registradas_created_at 
ON public.especialidades_registradas(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE public.especialidades_registradas ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all specialty registrations (they can see all users in a specialty)
CREATE POLICY "Users can read all specialty registrations"
ON public.especialidades_registradas FOR SELECT
USING (true);

-- Backend (service role) can do anything (via API with SUPABASE_KEY)
-- This is handled automatically by Supabase when using service role key
