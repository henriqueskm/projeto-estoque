// Compatibility boundary for the existing request-time supplier auth/data.
export default function SafisaLoading() {
  return <main className="px-4 py-8" aria-busy="true" aria-label="Carregando Portal Safisa"><h1 className="text-2xl font-black">Portal Safisa</h1><p className="mt-2">Verificando acesso…</p></main>;
}
