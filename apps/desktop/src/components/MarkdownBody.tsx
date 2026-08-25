import { type Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

export function MarkdownBody({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  if (!text.trim()) {
    return null;
  }
  return (
    <div className={`md ${className}`.trim()}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
