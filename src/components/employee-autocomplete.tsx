"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";

export type EmployeeAutocompleteOption = {
  id: string;
  full_name: string;
  registration: string | null;
  job_title?: string | null;
  function_name?: string | null;
  department?: string | null;
};

type EmployeeAutocompleteProps = {
  label: string;
  employees: EmployeeAutocompleteOption[];
  value: string;
  onChange: (employeeId: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  resetKey?: number;
  required?: boolean;
  disabled?: boolean;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function employeeLabel(employee: EmployeeAutocompleteOption) {
  return employee.registration
    ? `${employee.full_name} · Matrícula ${employee.registration}`
    : employee.full_name;
}

export function EmployeeAutocomplete({
  label,
  employees,
  value,
  onChange,
  placeholder = "Digite o nome ou a matrícula",
  emptyLabel,
  className = "",
  resetKey = 0,
  required = false,
  disabled = false,
}: EmployeeAutocompleteProps) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedEmployee = employees.find((employee) => employee.id === value) ?? null;

  useEffect(() => {
    if (!editing) setQuery(selectedEmployee ? employeeLabel(selectedEmployee) : "");
  }, [editing, selectedEmployee, value]);

  useEffect(() => {
    setQuery("");
    setEditing(false);
    setOpen(false);
    setActiveIndex(0);
  }, [resetKey]);

  const normalizedQuery = normalize(query);
  const options = useMemo(() => {
    if (!normalizedQuery) return [];
    return employees.filter((employee) => normalize(`${employee.full_name} ${employee.registration ?? ""}`).includes(normalizedQuery)).slice(0, 8);
  }, [employees, normalizedQuery]);
  const showOptions = open && Boolean(normalizedQuery);

  function chooseEmployee(employee: EmployeeAutocompleteOption) {
    setQuery(employeeLabel(employee));
    setEditing(false);
    setOpen(false);
    setActiveIndex(0);
    onChange(employee.id);
  }

  function clearSelection() {
    setQuery("");
    setEditing(false);
    setOpen(false);
    setActiveIndex(0);
    onChange("");
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => showOptions ? Math.min(current + 1, Math.max(options.length - 1, 0)) : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => showOptions ? Math.max(current - 1, 0) : 0);
    } else if (event.key === "Enter" && showOptions && options[activeIndex]) {
      event.preventDefault();
      chooseEmployee(options[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setEditing(false);
      setQuery(selectedEmployee ? employeeLabel(selectedEmployee) : "");
    }
  }

  return (
    <div className={`employee-autocomplete ${className}`.trim()}>
      <label htmlFor={inputId}><span>{label}</span></label>
      <div className="employee-autocomplete-control">
        <Search size={16} aria-hidden="true" />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={showOptions}
          aria-controls={listId}
          aria-activedescendant={showOptions && options[activeIndex] ? `${listId}-${options[activeIndex].id}` : undefined}
          aria-required={required || undefined}
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={editing ? query : selectedEmployee ? employeeLabel(selectedEmployee) : query}
          placeholder={value ? placeholder : emptyLabel ? `${emptyLabel} · digite para buscar` : placeholder}
          onFocus={() => {
            if (selectedEmployee) {
              setQuery(employeeLabel(selectedEmployee));
              setEditing(true);
              inputRef.current?.select();
            }
          }}
          onBlur={() => window.setTimeout(() => { setOpen(false); setEditing(false); }, 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setEditing(true);
            setOpen(true);
            setActiveIndex(0);
            if (value) onChange("");
          }}
          onKeyDown={handleKeyDown}
        />
        {(value || query) && <button className="employee-autocomplete-clear" type="button" aria-label={value ? "Limpar colaborador selecionado" : "Limpar busca"} onMouseDown={(event) => event.preventDefault()} onClick={clearSelection}><X size={15} /></button>}
        {showOptions && <div className="employee-suggestions" id={listId} role="listbox" aria-label={`${label} encontrados`}>
          {options.length ? options.map((employee, index) => <button
            type="button"
            role="option"
            id={`${listId}-${employee.id}`}
            aria-selected={index === activeIndex}
            key={employee.id}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => chooseEmployee(employee)}
          >
            <strong>{employee.full_name}</strong>
            <small>{employee.registration ? `Matrícula ${employee.registration}` : "Matrícula não informada"}{employee.function_name || employee.job_title ? ` · ${employee.function_name || employee.job_title}` : ""}{employee.department ? ` · ${employee.department}` : ""}</small>
          </button>) : <span>Nenhum colaborador encontrado.</span>}
        </div>}
      </div>
    </div>
  );
}
