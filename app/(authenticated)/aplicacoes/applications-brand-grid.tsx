import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import type { VehicleApplicationBrand } from "@/lib/vehicle-applications-domain";

export function ApplicationsBrandGrid({
  brands,
}: {
  brands: VehicleApplicationBrand[];
}) {
  return (
    <section
      aria-label="Marcas disponíveis"
      className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
    >
      {brands.map((brand) => (
        <Link
          key={brand.id}
          href={`/aplicacoes/${brand.slug}`}
          className="nk-focus group flex min-h-48 flex-col overflow-hidden rounded-2xl border border-border-neutral bg-surface shadow-[0_16px_38px_-30px_rgba(23,29,33,0.55)] transition duration-200 hover:-translate-y-0.5 hover:border-brand-gold-dark hover:shadow-[0_22px_42px_-28px_rgba(23,29,33,0.52)] sm:min-h-52"
        >
          <span className="flex flex-1 items-center justify-center bg-white px-3 py-4 sm:px-5">
            <Image
              src={brand.logoPath}
              alt=""
              width={161}
              height={168}
              sizes="(max-width: 639px) 38vw, (max-width: 1279px) 26vw, 18vw"
              className="h-28 w-full object-contain sm:h-32"
            />
          </span>
          <span className="flex min-h-14 items-center justify-between gap-2 border-t border-border-neutral px-3 py-3 sm:px-4">
            <span className="text-sm font-black text-text-primary sm:text-base">
              {brand.name}
            </span>
            <ArrowRightIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-brand-gold-dark transition-transform group-hover:translate-x-0.5"
            />
          </span>
        </Link>
      ))}
    </section>
  );
}
