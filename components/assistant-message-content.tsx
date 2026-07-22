import { Fragment, type ReactNode } from "react";

type MarkdownListBlock = {
  type: "unordered-list" | "ordered-list";
  items: string[];
};

type MarkdownBlock =
  | { type: "paragraph"; lines: string[] }
  | MarkdownListBlock;

const inlineMarkdownPattern =
  /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g;
const markdownLinkPattern = /^\[([^\]\n]+)\]\(([^\s)]+)\)$/;
const unorderedListPattern = /^\s*[-*+]\s+(.+)$/;
const orderedListPattern = /^\s*\d+[.)]\s+(.+)$/;

function getSafeLink(value: string) {
  try {
    const url = new URL(value);

    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function renderInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of value.matchAll(inlineMarkdownPattern)) {
    const matchIndex = match.index ?? 0;
    const token = match[0];

    if (matchIndex > cursor) {
      nodes.push(value.slice(cursor, matchIndex));
    }

    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${tokenIndex}`} className="font-black">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      const linkMatch = token.match(markdownLinkPattern);
      const safeHref = linkMatch ? getSafeLink(linkMatch[2]) : null;

      nodes.push(
        safeHref && linkMatch ? (
          <a
            key={`${keyPrefix}-link-${tokenIndex}`}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="nk-focus font-bold text-violet-800 underline decoration-violet-300 underline-offset-2 hover:text-violet-950"
          >
            {linkMatch[1]}
          </a>
        ) : (
          token
        ),
      );
    }

    cursor = matchIndex + token.length;
    tokenIndex += 1;
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  return nodes;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let currentListType: MarkdownListBlock["type"] | null = null;
  let currentListItems: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraphLines });
      paragraphLines = [];
    }
  }

  function flushList() {
    if (currentListType && currentListItems.length > 0) {
      blocks.push({ type: currentListType, items: currentListItems });
      currentListType = null;
      currentListItems = [];
    }
  }

  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const unorderedItem = line.match(unorderedListPattern)?.[1];
    const orderedItem = line.match(orderedListPattern)?.[1];
    const listType = unorderedItem
      ? "unordered-list"
      : orderedItem
        ? "ordered-list"
        : null;
    const listItem = unorderedItem ?? orderedItem;

    if (listType && listItem) {
      flushParagraph();

      if (currentListType !== listType) {
        flushList();
        currentListType = listType;
      }

      currentListItems.push(listItem);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderParagraph(lines: string[], blockIndex: number) {
  return (
    <p key={`paragraph-${blockIndex}`}>
      {lines.map((line, lineIndex) => (
        <Fragment key={`paragraph-${blockIndex}-line-${lineIndex}`}>
          {lineIndex > 0 ? <br /> : null}
          {renderInlineMarkdown(line, `paragraph-${blockIndex}-${lineIndex}`)}
        </Fragment>
      ))}
    </p>
  );
}

export function AssistantMessageContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="space-y-2 break-words [overflow-wrap:anywhere]">
      {blocks.map((block, blockIndex) => {
        if (block.type === "paragraph") {
          return renderParagraph(block.lines, blockIndex);
        }

        const List = block.type === "ordered-list" ? "ol" : "ul";

        return (
          <List
            key={`${block.type}-${blockIndex}`}
            className={`${
              block.type === "ordered-list" ? "list-decimal" : "list-disc"
            } space-y-1 pl-5`}
          >
            {block.items.map((item, itemIndex) => (
              <li key={`${block.type}-${blockIndex}-${itemIndex}`}>
                {renderInlineMarkdown(
                  item,
                  `${block.type}-${blockIndex}-${itemIndex}`,
                )}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
