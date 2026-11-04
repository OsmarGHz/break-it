import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CssDiffViewerProps {
  unifiedDiff: string;
}

export const CssDiffViewer: React.FC<CssDiffViewerProps> = ({ unifiedDiff }) => {
  const [copied, setCopied] = useState(false);

  const lines = unifiedDiff.split('\n');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(unifiedDiff);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header">
        <span className="mono-label">component.original.css → component.candidate.css</span>
        <button type="button" className="btn btn--ghost btn--xs" onClick={handleCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied diff' : 'Copy .diff'}
        </button>
      </div>
      <pre className="diff-viewer__body">
        {lines.map((line, i) => {
          let cls = 'diff-line';
          if (line.startsWith('+++') || line.startsWith('---')) {
            cls += ' diff-line--meta';
          } else if (line.startsWith('@@')) {
            cls += ' diff-line--hunk';
          } else if (line.startsWith('+')) {
            cls += ' diff-line--add';
          } else if (line.startsWith('-')) {
            cls += ' diff-line--del';
          }
          return (
            <div key={i} className={cls}>
              <span className="diff-line__num">{i + 1}</span>
              <span className="diff-line__content">{line || ' '}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
};

