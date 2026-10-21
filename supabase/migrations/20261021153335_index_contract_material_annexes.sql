create index if not exists material_contract_annexes_material_id_idx
  on public.material_contract_annexes (material_id);

create index if not exists material_consolidation_archive_source_material_idx
  on private.material_consolidation_reference_archive (source_material_id);

create index if not exists material_consolidation_archive_canonical_material_idx
  on private.material_consolidation_reference_archive (canonical_material_id);
