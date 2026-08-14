import Link from "next/link";
import { manualArticles } from "@/lib/public-manual-content";

export function ManualNavigation({ compact = false }: { compact?: boolean }) {
  const links = (
    <nav className="manual-nav" aria-label="Tópicos do manual">
      {manualArticles.map((article, index) => (
        <Link key={article.slug} href={`/manual/${article.slug}`}>
          <span>{String(index + 1).padStart(2, "0")}</span>{article.title}
        </Link>
      ))}
    </nav>
  );

  if (!compact) return links;

  return (
    <details className="manual-topic-drawer">
      <summary>Tópicos do manual <span aria-hidden="true">⌄</span></summary>
      {links}
    </details>
  );
}
