-- Conquiguias | Certificate Registry Table (Supabase)
-- Run this in Supabase SQL Editor
-- This table stores all certificate registrations with unique 9-digit codes

CREATE TABLE IF NOT EXISTS public.especialidades_registradas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_especialidad TEXT NOT NULL,
    nombre_instructor TEXT,
    nombre_usuario TEXT NOT NULL,
    fecha_especialidad TIMESTAMP,
    calificaciones JSONB,
    nota_tarea DECIMAL(10, 2),
    nota_examen DECIMAL(10, 2),
    correo_electronico TEXT NOT NULL,
    codigo_9digitos VARCHAR(9) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_especialidades_registradas_email_especialidad 
ON public.especialidades_registradas(correo_electronico, nombre_especialidad);

CREATE INDEX idx_especialidades_registradas_codigo 
ON public.especialidades_registradas(codigo_9digitos);

CREATE INDEX idx_especialidades_registradas_created_at 
ON public.especialidades_registradas(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE public.especialidades_registradas ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own records
CREATE POLICY "Users can read their own certificate registrations"
ON public.especialidades_registradas FOR SELECT
USING (correo_electronico = auth.jwt() ->> 'email');

-- Allow authenticated users to insert their own records
CREATE POLICY "Users can insert their own certificate registrations"
ON public.especialidades_registradas FOR INSERT
WITH CHECK (correo_electronico = auth.jwt() ->> 'email');

-- Backend (service role) can do anything (via API with SUPABASE_KEY)
-- This is handled automatically by Supabase when using service role key
