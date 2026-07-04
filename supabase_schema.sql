-- Script de Inicialización para Supabase (Miravoz)
-- Ejecutar esto en el SQL Editor de Supabase.

-- 1. Habilitar la extensión UUID si no existe
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabla para configuraciones del usuario (ej. Calibración)
CREATE TABLE IF NOT EXISTS public.user_settings (
    id uuid references auth.users not null primary key,
    name text,
    lastname text,
    calibration_weights jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar RLS en user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Políticas para user_settings (El usuario solo puede leer y modificar sus propios datos)
CREATE POLICY "Los usuarios pueden ver su propia configuración"
    ON public.user_settings FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Los usuarios pueden actualizar su propia configuración"
    ON public.user_settings FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Los usuarios pueden insertar su propia configuración"
    ON public.user_settings FOR INSERT
    WITH CHECK (auth.uid() = id);

-- 3. Crear el Bucket de Storage para los Tableros
INSERT INTO storage.buckets (id, name, public) 
VALUES ('boards', 'boards', false) 
ON CONFLICT (id) DO NOTHING;

-- Políticas para Storage
-- Los usuarios pueden subir sus propios tableros (El path debe empezar con su user_id)
CREATE POLICY "Permitir subida de tableros a dueños"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'boards' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Los usuarios pueden leer sus propios tableros
CREATE POLICY "Permitir lectura de tableros propios"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'boards' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Los usuarios pueden borrar sus propios tableros
CREATE POLICY "Permitir borrado de tableros propios"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'boards' AND (storage.foldername(name))[1] = auth.uid()::text);


-- 4. Trigger para crear automáticamente el perfil de user_settings cuando un usuario hace login exitoso
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_settings (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger firing on auth.users insert
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
