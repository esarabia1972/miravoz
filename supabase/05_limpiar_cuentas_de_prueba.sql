-- MiraVoz — Borrar las cuentas de prueba (10/10/2026, pedido de Esteban: "es todo prueba interno, se puede borrar")
-- Conserva SOLO esteban.sarabia@gmail.com (al entrar con Google se vincula a esta misma cuenta y mantiene sus tableros).
-- Borra las demás cuentas y, en cascada, sus profesionales, tableros, usuarios, códigos, asignaciones y tablets.
-- IRREVERSIBLE. Corre en una transacción: si algo falla, no se borra nada.

begin;

delete from auth.users
where email is distinct from 'esteban.sarabia@gmail.com';

commit;

-- Verificación: debería quedar una sola cuenta
select email, raw_app_meta_data->'providers' as metodos,
       (select count(*) from public.boards b where b.owner_professional_id = u.id) as tableros
from auth.users u;
