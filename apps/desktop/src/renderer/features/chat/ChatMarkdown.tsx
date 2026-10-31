import { memo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import Markdown from 'react-markdown';
import type { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { copyText } from '../../components/copyText';
import styles from './ChatMarkdown.module.css';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/** Model output can label links, but cannot navigate local paths or supply executable URLs. */
function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

function CodeBlock({ children, node }: ComponentProps<'pre'> & ExtraProps) {
  const pre = useRef<HTMLPreElement>(null);
  const [notice, setNotice] = useState('');
  const code = node?.children[0];
  const classes = code?.type === 'element' ? code.properties.className : undefined;
  const language = Array.isArray(classes)
    ? classes
        .find((value) => typeof value === 'string' && value.startsWith('language-'))
        ?.toString()
        .slice(9)
    : undefined;
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{language || 'Plain text'}</span>
        {notice && <span role="status">{notice}</span>}
        <button
          type="button"
          aria-label="Copy code"
          onClick={() => {
            // Markdown adds one final newline to code elements; copy the code without that delimiter.
            const text = (pre.current?.textContent ?? '').replace(/\n$/, '');
            void copyText(text).then(
              () => setNotice('Copied'),
              () => setNotice('Could not copy code. Select it and copy manually.'),
            );
          }}
        >
          Copy code
        </button>
      </div>
      <pre ref={pre} tabIndex={0} aria-label={language ? language + ' code' : 'Code block'}>
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: CodeBlock,
  table: ({ children }) => (
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Scrollable table">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href, title }) =>
    href ? (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Chat attachments are separate capabilities. Rendering text never fetches remote images.
  img: ({ alt }) => <span>{alt}</span>,
};

/** Structured text only: no raw HTML, scripts, embeds, or automatic remote resources. */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={safeUrl}
      >
        {text}
      </Markdown>
    </div>
  );
});
