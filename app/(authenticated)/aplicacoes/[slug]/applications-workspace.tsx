"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeftIcon, ChevronDownIcon, SearchIcon } from "@/components/icons";
import {
  filterVehicleApplications,
  groupVehicleApplications,
  type VehicleApplication,
  type VehicleApplicationBrand,
  type VehicleApplicationCategory,
  vehicleApplicationCategoryLabels,
} from "@/lib/vehicle-applications-domain";

type ApplicationsWorkspaceProps = {
  brand: VehicleApplicationBrand;
  applications: VehicleApplication[];
};

const categoryOrder: VehicleApplicationCategory[] = [
  "TRUCK",
  "BUS",
  "MICROBUS",
];

function applicationCountLabel(count: number) {
  return `${count} ${count === 1 ? "aplicação" : "aplicações"}`;
}

export function ApplicationsWorkspace({
  brand,
  applications,
}: ApplicationsWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<
    VehicleApplicationCategory | "ALL"
  >("ALL");
  const availableCategories = useMemo(
    () =>
      categoryOrder.filter((candidate) =>
        applications.some((application) => application.category === candidate),
      ),
    [applications],
  );
  const filteredApplications = useMemo(
    () => filterVehicleApplications(applications, query, category),
    [applications, category, query],
  );
  const groups = useMemo(
    () => groupVehicleApplications(filteredApplications),
    [filteredApplications],
  );
  const restrictions = filteredApplications.filter(
    (application) => application.applicationKind === "RESTRICTION",
  );
  const isSearching = query.trim().length > 0;

  return (
    <>
      <Link
        href="/aplicacoes"
        className="nk-focus inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-black text-brand-gold-ink underline decoration-brand-gold/50 underline-offset-4 transition hover:text-brand-charcoal"
      >
        <ArrowLeftIcon className="size-5" />
        Todas as marcas
      </Link>

      <header className="mt-2 flex items-center gap-4 border-b border-border-neutral pb-5 sm:gap-5">
        <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border-neutral bg-white p-2 sm:size-24">
          <Image
            src={brand.logoPath}
            alt=""
            width={161}
            height={168}
            className="h-full w-full object-contain"
          />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-[-0.025em] text-text-primary uppercase sm:text-4xl">
            {brand.name}
          </h1>
          <p className="mt-1 text-sm font-semibold text-text-muted sm:text-base">
            {applications.length}{" "}
            {applications.length === 1
              ? "aplicação cadastrada"
              : "aplicações cadastradas"}
          </p>
        </div>
      </header>

      <section aria-label="Busca e filtros" className="mt-5">
        <label htmlFor="application-search" className="sr-only">
          Buscar veículo, kit, servoembreagem ou observação
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-muted" />
          <input
            id="application-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar veículo ou kit..."
            className="nk-field min-h-12 w-full rounded-2xl border py-3 pr-4 pl-12 text-base font-semibold outline-none"
          />
        </div>

        {availableCategories.length > 0 ? (
          <div
            role="group"
            aria-label="Filtrar por categoria"
            className="mt-3 flex flex-wrap gap-2"
          >
            <button
              type="button"
              aria-pressed={category === "ALL"}
              onClick={() => setCategory("ALL")}
              className={`nk-focus min-h-11 shrink-0 rounded-full px-4 text-sm font-black transition ${
                category === "ALL"
                  ? "bg-brand-charcoal text-white"
                  : "border border-border-neutral bg-surface text-text-primary hover:border-brand-gold-dark"
              }`}
            >
              Todos
            </button>
            {availableCategories.map((availableCategory) => (
              <button
                key={availableCategory}
                type="button"
                aria-pressed={category === availableCategory}
                onClick={() => setCategory(availableCategory)}
                className={`nk-focus min-h-11 shrink-0 rounded-full px-4 text-sm font-black transition ${
                  category === availableCategory
                    ? "bg-brand-charcoal text-white"
                    : "border border-border-neutral bg-surface text-text-primary hover:border-brand-gold-dark"
                }`}
              >
                {vehicleApplicationCategoryLabels[availableCategory]}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <p className="mt-5 text-sm font-bold text-text-muted" aria-live="polite">
        {filteredApplications.length}{" "}
        {filteredApplications.length === 1
          ? "aplicação encontrada"
          : "aplicações encontradas"}
      </p>

      {restrictions.length > 0 ? (
        <section aria-labelledby="restrictions-title" className="mt-3 space-y-3">
          <h2 id="restrictions-title" className="sr-only">
            Restrições
          </h2>
          {restrictions.map((restriction) => (
            <article
              key={restriction.id}
              className="rounded-2xl border border-red-300 bg-red-50 p-4 text-red-950 shadow-[0_14px_32px_-28px_rgba(127,29,29,0.65)] sm:p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-red-900 px-3 py-1 text-xs font-black tracking-[0.08em] text-white uppercase">
                  Restrição
                </span>
                {restriction.category ? (
                  <span className="text-xs font-black uppercase">
                    {vehicleApplicationCategoryLabels[restriction.category]}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-3 text-lg font-black">
                {restriction.vehicleModel}
              </h3>
              <p className="mt-1 text-sm leading-6 font-bold">
                {restriction.observation}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section aria-label="Kits e aplicações" className="mt-3 space-y-3">
          {groups.map((group) => (
            <details
              key={`${group.key}-${isSearching ? query : "idle"}`}
              open={isSearching || group.applications.length <= 3}
              className="group overflow-hidden rounded-2xl border border-border-neutral bg-surface shadow-[0_15px_34px_-30px_rgba(23,29,33,0.58)]"
            >
              <summary className="nk-focus flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden sm:px-5 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <strong className="text-lg font-black text-text-primary">
                    {group.sourceKitCode}
                  </strong>
                  <span aria-hidden="true" className="text-brand-gold-dark">
                    •
                  </span>
                  <span className="font-black text-text-primary">
                    {group.sourceServoLabel}
                  </span>
                  <span className="w-full text-xs font-bold text-text-muted sm:ml-auto sm:w-auto sm:text-sm">
                    {applicationCountLabel(group.applications.length)}
                  </span>
                </span>
                {group.catalogResolutionStatus === "UNRESOLVED" ? (
                  <span className="hidden rounded-full bg-amber-100 px-2.5 py-1 text-[0.68rem] font-black text-amber-950 sm:inline-flex">
                    Catálogo pendente
                  </span>
                ) : null}
                <ChevronDownIcon className="size-5 shrink-0 text-brand-gold-dark transition-transform duration-200 group-open:rotate-180" />
              </summary>

              <div className="border-t border-border-neutral bg-app-background/55 px-4 py-2 sm:px-5">
                {group.catalogResolutionStatus === "UNRESOLVED" ? (
                  <p className="border-b border-amber-200 py-3 text-xs leading-5 font-bold text-amber-950 sm:hidden">
                    Código preservado da planilha. Vínculo ao catálogo pendente.
                  </p>
                ) : null}
                <ul className="divide-y divide-border-neutral">
                  {group.applications.map((application) => (
                    <li key={application.id} className="py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-black text-text-primary">
                          {application.vehicleModel}
                        </p>
                        {application.category ? (
                          <span className="rounded-full border border-border-neutral bg-white px-2.5 py-1 text-[0.68rem] font-black text-text-muted uppercase">
                            {vehicleApplicationCategoryLabels[application.category]}
                          </span>
                        ) : null}
                      </div>
                      {application.observation ? (
                        <p className="mt-1 max-w-3xl text-sm leading-6 font-semibold text-text-muted">
                          {application.observation}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ))}
        </section>
      ) : null}

      {filteredApplications.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border-neutral bg-surface px-5 py-10 text-center">
          <h2 className="text-lg font-black text-text-primary">
            Nenhuma aplicação encontrada
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 font-semibold text-text-muted">
            Revise a busca ou escolha outra categoria. Você pode pesquisar por
            kit, servoembreagem, veículo ou observação.
          </p>
        </div>
      ) : null}
    </>
  );
}
