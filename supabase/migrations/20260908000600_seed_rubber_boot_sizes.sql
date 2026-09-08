insert into public.material_variants (organization_id, material_id, name, size, active)
select m.organization_id, m.id, size::text, size::text, true
from public.materials m
cross join generate_series(37, 45) as sizes(size)
where lower(m.name) = 'bota de borracha'
on conflict (organization_id, material_id, name) do update
set size = excluded.size, active = true;
