import Link from "next/link";
import { manualArticles } from "@/lib/public-manual-content";

export default function ManualHomePage() {
  return (
    <div className="manual-home">
      <p className="public-eyebrow">Manual NK Estoque</p>
      <h1>Encontre o caminho certo para cada operação.</h1>
      <p className="manual-intro">Guias objetivos sobre o que usar, como revisar e qual resultado esperar.</p>
      <div className="manual-card-grid">
        {manualArticles.map((article, index) => (
          <Link key={article.slug} href={`/manual/${article.slug}`} className="manual-card">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h2>{article.title}</h2>
            <p>{article.summary}</p>
            <strong>Ver tópico <span aria-hidden="true">→</span></strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
