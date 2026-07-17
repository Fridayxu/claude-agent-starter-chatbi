/** Extract [FILE: name|base64content] blocks and return download buttons */
function extractFileBlocks(content: string): Array<{name:string, b64:string}> {
  const re = /\[FILE:\s*([^|]+)\|([^\]]+)\]/g;
  const result: Array<{name:string, b64:string}> = [];
  let m;
  while ((m = re.exec(content)) !== null) result.push({name: m[1].trim(), b64: m[2].trim()});
  return result;
}

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ImageAttachment } from '../types';
import { useT } from '../i18n';
import styles from './ChatBubble.module.css';

interface Props {
  message: Message;
}

/** Where the inline `WSA` link in the wsa_missing label points. */
const WSA_DOC_URL = 'https://pages.edgeone.ai/document/sandbox-network-search-tool';

/**
 * Render the wsa_missing chip label with a clickable `WSA` token.
 *
 * The i18n string carries a `{0}` placeholder marking where the link
 * text goes, so en ("…needs a {0} API key") and zh ("…需配置 {0} API Key")
 * both produce a single anchor in the right spot. Falls back to the raw
 * string if the placeholder is missing (e.g. translator forgot it).
 */
function renderWsaMissingLabel(template: string) {
  const parts = template.split('{0}');
  if (parts.length !== 2) return template;
  return (
    <>
      {parts[0]}
      <a
        className={styles.searchLabelLink}
        href={WSA_DOC_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        WSA
      </a>
      {parts[1]}
    </>
  );
}

const TABLE_ROW_BOUNDARY = /\|\s+\|/g;
const TABLE_SEPARATOR_ROW = /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function normalizeCompactTableLine(line: string): string {
  if (!line.includes('| |')) return line;

  const pipeIndexes = [...line.matchAll(/\|/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);

  for (const index of pipeIndexes) {
    const table = line.slice(index);
    const normalizedTable = table.replace(TABLE_ROW_BOUNDARY, '|\n|');
    const rows = normalizedTable
      .split('\n')
      .map((row) => row.trim())
      .filter(Boolean);

    if (rows.length >= 2 && TABLE_SEPARATOR_ROW.test(rows[1])) {
      const prefix = line.slice(0, index).trimEnd();
      return prefix ? `${prefix}\n${normalizedTable}` : normalizedTable;
    }
  }

  return line;
}

function normalizeMarkdown(content: string): string {
  let inCodeFence = false;

  return content
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      return inCodeFence ? line : normalizeCompactTableLine(line);
    })
    .join('\n');
}

/** Get renderable image src from ImageAttachment or legacy base64 string */
function getImageSrc(img: ImageAttachment | string): string {
  if (typeof img === 'string') return `data:image/png;base64,${img}`;
  return img.url || '';
}

export default function ChatBubble({ message }: Props) {
  const { t, lang } = useT();
  const isUser = message.role === 'user';
  const content = isUser ? message.content : normalizeMarkdown(message.content);
  const hasImages = message.images && message.images.length > 0;
  const activity = message.activity;
  const fileBlocks = (!isUser && !message.streaming) ? extractFileBlocks(message.content) : [];

  const downloadFile = (name: string, b64: string) => {
    const mime = name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                 name.endsWith('.pdf') ? 'application/pdf' :
                 name.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    const url = `data:${mime};base64,${b64}`;
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  };

  // Don't render empty assistant messages (unless they have images)
  if (!isUser && !message.content && !hasImages && !activity) return null;

  return (
    <div className={`${styles.row} ${isUser ? styles.userRow : styles.botRow}`}>
      {!isUser && <div className={styles.avatar}>⬡</div>}
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.botBubble}`}>
        {!isUser && activity?.type === 'tool' && (
          <div className={styles.toolActivity} role="status" aria-live="polite">
            <span className={styles.toolActivityDot} />
            <span className={styles.toolActivityLabel}>{activity.label}</span>
          </div>
        )}
        {!isUser && activity?.type === 'web_search' && (
          <div
            className={`${styles.webSearchActivity} ${
              activity.status === 'error' ? styles.webSearchError :
              activity.status === 'done'  ? styles.webSearchDone  :
                                            styles.webSearchActive
            }`}
            role="status"
            aria-live="polite"
          >
            <span className={styles.searchGlyph} aria-hidden="true" />
            <span className={styles.searchLabel}>{
              activity.status === 'error' && activity.errorCode === 'wsa_missing'
                ? renderWsaMissingLabel(t('webSearch.error.wsaMissing'))
                : activity.label
            }</span>
            {activity.status === 'error' ? (
              <>
                <span className={styles.searchErrorMark} aria-hidden="true">⚠️</span>
                {activity.errorCode === 'wsa_missing' && (
                  <a
                    className={styles.searchErrorCta}
                    href="https://pages.edgeone.ai/document/sandbox-network-search-tool"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t('webSearch.error.wsaCta')} →
                  </a>
                )}
              </>
            ) : (
              <span className={styles.searchDots} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        )}
        {isUser
          ? content
          : (
            <>
              {message.content && (
                <div className={`${styles.markdown} ${message.streaming ? styles.markdownStreaming : ''}`}>
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const lang = match ? match[1] : '';
                        const codeStr = String(children).replace(/\n$/, '');
                        // Collapse HTML code blocks — show preview button instead
                        if (lang === 'html' && !message.streaming) {
                          return (
                            <div className={styles.htmlBlockCollapsed}>
                              <div className={styles.htmlBlockBar}>
                                📊 HTML Dashboard
                                <button
                                  className={styles.htmlBlockBtn}
                                  onClick={() => {
                                    const w = window.open('', 'dashboard', 'width=1200,height=800');
                                    if (w) { w.document.write(codeStr); w.document.close(); }
                                  }}
                                >
                                  Open Preview
                                </button>
                              </div>
                            </div>
                          );
                        }
                        // Normal code block
                        return (
                          <pre className={styles.codeBlock}>
                            <code className={className} {...props}>{children}</code>
                          </pre>
                        );
                      },
                    }}
                  >
                    {content}
                  </Markdown>
                </div>
              )}
              {fileBlocks.length > 0 && (
                <div style={{marginTop:'10px',display:'flex',flexWrap:'wrap',gap:'6px'}}>
                  {fileBlocks.map((fb, i) => (
                    <button key={i}
                      onClick={() => downloadFile(fb.name, fb.b64)}
                      style={{
                        display:'inline-flex',alignItems:'center',gap:'4px',
                        padding:'5px 10px',borderRadius:'6px',
                        border:'1px solid var(--color-primary)',
                        background:'var(--color-primary-dim)',
                        color:'var(--color-primary)',
                        fontSize:'.68rem',cursor:'pointer',
                        fontFamily:'var(--font-code)'
                      }}>
                      📥 {fb.name}
                    </button>
                  ))}
                </div>
              )}
              {hasImages && (
                <div className={styles.imageGrid}>
                  {message.images!.map((img, idx) => {
                    const src = getImageSrc(img);
                    if (!src) return null;
                    return (
                      <a
                        key={typeof img === 'string' ? idx : img.id}
                        href={src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.imageLink}
                      >
                        <img
                          src={src}
                          alt={`Screenshot ${idx + 1}`}
                          className={styles.screenshot}
                          loading="lazy"
                        />
                      </a>
                    );
                  })}
                </div>
              )}
            </>
          )
        }
        <span className={styles.time}>
          {new Date(message.timestamp).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {isUser && (
        <div className={`${styles.avatar} ${styles.userAvatar}`}>
          U
        </div>
      )}
    </div>
  );
}
