import { useState, useRef, useCallback, KeyboardEvent, ChangeEvent } from 'react';
import { useT, MessageKeys } from '../i18n';
import styles from './ChatInput.module.css';

export interface FileInfo {
  name: string;
  content: string;
  mimeType: string;
}

interface Props {
  onSend: (text: string, files: FileInfo[]) => void;
  onStop: () => void;
  onClear: () => void;
  disabled: boolean;
}

const PRESET_KEYS = ['preset.1', 'preset.2', 'preset.3'] as const;

export default function ChatInput({ onSend, onStop, onClear, disabled }: Props) {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useT();

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && !files.length) || disabled) return;
    onSend(trimmed, files);
    setValue('');
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, files, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const handlePreset = (text: string) => {
    if (disabled) return;
    onSend(text, []);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    for (const file of e.target.files || []) {
      if (file.size > 50 * 1024 * 1024) {
        alert(`File too large: ${file.name} (${(file.size/1024/1024).toFixed(1)}MB). Max 50MB.`);
        continue;
      }
      const isLarge = file.size > 800 * 1024; // >800KB: sample to keep request body <1MB
      const reader = new FileReader();
      reader.onload = () => {
        let content: string;
        let displayName = file.name;
        if (isLarge && (file.type.includes('text') || file.type.includes('csv') || file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
          // Sample: take first ~500KB of text (≈8K-10K rows), then base64
          const text = reader.result as string;
          const sample = text.substring(0, 500 * 1024);
          const lines = sample.split('\n').length;
          content = btoa(unescape(encodeURIComponent(sample)));
          displayName = `${file.name} (sampled: first ${lines} lines, ${(sample.length/1024).toFixed(0)}KB)`;
        } else if (isLarge) {
          // Binary large file: read only first 500KB
          const b64Full = (reader.result as string).split(',')[1] || '';
          content = b64Full.substring(0, 650 * 1024); // ~500KB decoded
          displayName = `${file.name} (sampled: first ~500KB)`;
        } else {
          content = (reader.result as string).split(',')[1] || '';
        }
        setFiles(prev => [...prev, { name: displayName, content, mimeType: file.type || 'text/csv' }]);
      };
      if (isLarge && (file.type.includes('text') || file.type.includes('csv') || file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
        reader.readAsText(file);
      } else {
        reader.readAsDataURL(file);
      }
    }
    if (e.target) e.target.value = '';
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className={styles.bar}>
      {/* File tags */}
      {files.length > 0 && (
        <div className={styles.fileTags}>
          {files.map((f, i) => {
            const ext = (f.name || '').split('.').pop()?.toUpperCase() || 'FILE';
            return (
              <span key={i} className={styles.fileTag}>
                <span className={styles.fileTagName}>📄 {f.name}</span>
                <span className={styles.fileTagExt}>{ext}</span>
                <button className={styles.fileTagRem} onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`}>×</button>
              </span>
            );
          })}
        </div>
      )}

      <div className={styles.presets}>
        {PRESET_KEYS.map(key => (
          <button
            key={key}
            className={styles.presetChip}
            onClick={() => handlePreset(t(key as MessageKeys))}
            disabled={disabled}
          >
            {t(key as MessageKeys)}
          </button>
        ))}
      </div>

      <div className={`${styles.inputWrap} ${disabled ? styles.inputDisabled : ''}`}>
        {/* File upload button */}
        <button
          className={styles.fileBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach file"
          title="Attach CSV/Excel file"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.json,.txt"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder={disabled ? "ChatBI is replying..." : t("chat.placeholder")}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          rows={1}
          disabled={disabled}
        />
        <button
          className={`${styles.sendBtn} ${(!value.trim() && !files.length) || disabled ? styles.sendDisabled : ''}`}
          onClick={handleSend}
          disabled={(!value.trim() && !files.length) || disabled}
          aria-label={t("aria.send")}
        >
          <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
            <path d="M3 10L17 3l-4 7 4 7L3 10z" fill="currentColor"/>
          </svg>
        </button>
        <button
          className={styles.clearBtn}
          onClick={onClear}
          disabled={disabled}
          aria-label={t("aria.clearHistory")}
          title={t("aria.clearHistory")}
        >
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
        {disabled && (
          <button
            className={styles.stopBtn}
            onClick={onStop}
            aria-label={t("aria.stopGeneration")}
            title={t("aria.stopGeneration")}
          >
            <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
              <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor"/>
            </svg>
          </button>
        )}
      </div>
      <p className={styles.hint}>{t("chat.hint")}</p>
    </div>
  );
}
