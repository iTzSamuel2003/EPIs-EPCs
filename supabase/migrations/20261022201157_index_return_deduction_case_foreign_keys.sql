create index if not exists return_deduction_cases_employee_id_fk_idx
  on public.return_deduction_cases (employee_id);

create index if not exists return_deduction_cases_return_id_fk_idx
  on public.return_deduction_cases (return_id);

create index if not exists return_deduction_cases_reviewed_by_fk_idx
  on public.return_deduction_cases (reviewed_by);
