import React, { useMemo } from 'react';

interface BaselinePreviewProps {
  sanitizedHtml: string;
  sanitizedCss: string;
}

export const BaselinePreview: React.FC<BaselinePreviewProps> = ({
  sanitizedHtml,
  sanitizedCss,
}) => {
  const srcDoc = useMemo(() => {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: #eef2f6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  main {
    box-sizing: border-box;
    padding: 20px 16px;
  }
  ${sanitizedCss}
</style>
</head>
<body>
  <main>${sanitizedHtml}</main>
</body>
</html>`;
  }, [sanitizedHtml, sanitizedCss]);

  return (
    <div className="baseline-preview-wrap">
      <div className="baseline-preview-bar">
        <span className="status-dot status-dot--pass" />
        <span>Isolated Static Preview (Ideal Sample Content · 460px)</span>
      </div>
      <iframe
        title="Isolated Baseline Component Preview"
        sandbox=""
        srcDoc={srcDoc}
        className="baseline-preview-iframe"
      />
    </div>
  );
};

