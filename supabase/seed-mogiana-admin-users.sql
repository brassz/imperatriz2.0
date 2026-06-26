-- Admins MOGIANA (empresa3) — execute no SQL Editor do Supabase
-- otawgdmokeavpmngjtac

INSERT INTO public.users (email, password_hash, full_name, role, is_active) VALUES
    ('admin@nexus.com', '1020', 'Administrador Nexus', 'admin', true),
    ('douglas@nexus.com', '1020', 'Douglas Nexus', 'admin', true),
    ('vinicius@nexus.com', '36996352123', 'Vinicius Admin', 'admin', true)
ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    is_active = true,
    updated_at = NOW();

SELECT id, email, full_name, role, is_active, created_at, updated_at
FROM public.users
WHERE email IN ('admin@nexus.com', 'douglas@nexus.com', 'vinicius@nexus.com')
ORDER BY email;
