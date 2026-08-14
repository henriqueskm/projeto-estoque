import Link from "next/link";

const navigation = [
  { href: "/apresentacao#funcionalidades", label: "Funcionalidades" },
  { href: "/apresentacao#assistente", label: "Assistente NK" },
  { href: "/apresentacao#pedido-por-foto", label: "Pedido por foto" },
  { href: "/manual", label: "Manual" },
];

function PublicBrand() {
  return (
    <Link className="public-brand nk-focus" href="/apresentacao" aria-label="NK Estoque — apresentação">
      <span className="public-brand-mark" aria-hidden="true">
        <span>N</span><span>K</span>
      </span>
      <span>
        <strong>NK Estoque</strong>
        <small>Negócios K</small>
      </span>
    </Link>
  );
}
export function PublicHeader() {
  return (
    <header className="public-header">
      <div className="public-shell public-header-inner">
        <PublicBrand />

        <nav className="public-nav" aria-label="Navegação principal">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>{item.label}</Link>
          ))}
        </nav>

        <div className="public-header-actions">
          <Link className="public-login-link nk-focus" href="/login">Entrar no sistema</Link>
          <Link className="public-button public-button-small" href="/apresentacao#funcionalidades">
            Conhecer as funcionalidades
          </Link>
        </div>

        <details className="public-mobile-menu">
          <summary className="nk-focus" aria-label="Abrir menu">
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </summary>
          <nav aria-label="Navegação mobile">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href}>{item.label}</Link>
            ))}
            <Link href="/login">Entrar no sistema</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
