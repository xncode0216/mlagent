import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type Props = {
  content: string;
};

// Module-level so the plugin arrays keep a stable identity and react-markdown can
// reuse its processor across streaming re-renders. This module is loaded lazily
// (see AgentWorkspace) so react-markdown + highlight.js stay out of the initial
// bundle until the first agent message renders.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

/**
 * Renders agent message content as GitHub-flavored Markdown (tables, lists,
 * fenced code) with syntax-highlighted code blocks.
 *
 * Security: react-markdown escapes raw HTML by default and we deliberately do
 * not add `rehype-raw`, so untrusted model output cannot inject markup. Links
 * open in a new tab with `noreferrer` so a rendered link cannot reach back into
 * the opener.
 */
export const MarkdownMessage = memo(function MarkdownMessage({ content }: Props) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownMessage;
