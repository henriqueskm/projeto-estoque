import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getManualArticle, manualArticles } from "@/lib/public-manual-content";

type ManualArticlePageProps = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return manualArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: ManualArticlePageProps): Promise<Metadata> {
  const article = getManualArticle((await params).slug);
  if (!article) return {};
  return { title: `${article.title} | Manual NK Estoque`, description: article.summary, robots: { index: false, follow: false } };
}

export default async function ManualArticlePage({ params }: ManualArticlePageProps) {
  const article = getManualArticle((await params).slug);
  if (!article) notFound();
  const index = manualArticles.findIndex((item) => item.slug === article.slug);
  const previous = index > 0 ? manualArticles[index - 1] : null;
  const next = index < manualArticles.length - 1 ? manualArticles[index + 1] : null;

  return (
    <article className="manual-article">
      <header><p className="public-eyebrow">Manual NK Estoque</p><h1>{article.title}</h1><p>{article.summary}</p></header>
      <section id="objetivo"><h2>Objetivo</h2><p>{article.objective}</p></section>
      <section id="quando-usar"><h2>Quando usar</h2><p>{article.whenToUse}</p></section>
      <section id="passos"><h2>Passo a passo</h2><ol className="manual-steps">{article.steps.map((step, stepIndex) => <li key={step}><span>{stepIndex + 1}</span><p>{step}</p></li>)}</ol></section>
      {article.image ? <figure className={`manual-image ${article.image.height > article.image.width ? "manual-image-mobile" : ""}`}><Image src={article.image.src} alt={article.image.alt} width={article.image.width} height={article.image.height} sizes="(max-width: 767px) 88vw, 42rem" /></figure> : null}
      <section id="resultado"><h2>Resultado esperado</h2><p>{article.expectedResult}</p></section>
      {article.warning ? <aside className="manual-callout"><strong>Aviso importante</strong><p>{article.warning}</p></aside> : null}
      <nav className="manual-article-pagination" aria-label="Artigos anterior e próximo">
        {previous ? <Link href={`/manual/${previous.slug}`}><span>Anterior</span><strong>← {previous.title}</strong></Link> : <span />}
        {next ? <Link href={`/manual/${next.slug}`}><span>Próximo</span><strong>{next.title} →</strong></Link> : <Link href="/manual"><span>Concluir</span><strong>Voltar ao manual →</strong></Link>}
      </nav>
    </article>
  );
}
