import Link from "next/link";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-shell public-footer-inner">
        <div>
          <strong>NK Estoque</strong>
          <span>Uma solução Negócios K.</span>
        </div>
        <nav aria-label="Links do rodapé">
          <Link href="/apresentacao">Apresentação</Link>
          <Link href="/manual">Manual</Link>
          <Link href="/login">Entrar no sistema</Link>
        </nav>
      </div>
    </footer>
  );
}
