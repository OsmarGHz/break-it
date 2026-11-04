import fs from 'node:fs';
import path from 'node:path';
import type { ApiHealthStatus } from '../src/shared/types.js';

export interface ServerConfig {
  port: number;
  host: string;
  projectRoot: string;
  artifactsDir: string;
  modelApiKey: string;
  demoPassword: string;
  keySource: '.env.local' | 'process.env' | 'missing';
  metaBaseUrl: string;
  metaSparkModel: string;
}

function parseDotEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function getServerConfig(customRoot?: string): ServerConfig {
  const projectRoot = customRoot || process.cwd();
  const envLocalPath = path.join(projectRoot, '.env.local');
  const localVars = parseDotEnvFile(envLocalPath);

  const envApiKey = (process.env.MODEL_API_KEY || '').trim();
  const localApiKey = (localVars.MODEL_API_KEY || '').trim();

  let modelApiKey = '';
  let keySource: '.env.local' | 'process.env' | 'missing' = 'missing';
  if (localApiKey) {
    modelApiKey = localApiKey;
    keySource = '.env.local';
  } else if (envApiKey) {
    modelApiKey = envApiKey;
    keySource = 'process.env';
  }

  const metaBaseUrl = (
    localVars.META_BASE_URL ||
    process.env.META_BASE_URL ||
    'https://api.meta.ai/v1'
  ).replace(/\/+$/, '');

  const metaSparkModel = (
    localVars.META_SPARK_MODEL ||
    process.env.META_SPARK_MODEL ||
    'muse-spark-1.3'
  ).trim();

  const port = Number(process.env.PORT || process.env.API_PORT || localVars.API_PORT || 4174);
  const host = process.env.API_HOST || (process.env.DYNO ? '0.0.0.0' : '127.0.0.1');
  const artifactsDir = process.env.ARTIFACTS_DIR || path.join(projectRoot, 'artifacts');

  return {
    port,
    host,
    projectRoot,
    artifactsDir,
    modelApiKey,
    demoPassword: process.env.DEMO_PASSWORD || localVars.DEMO_PASSWORD || '',
    keySource,
    metaBaseUrl,
    metaSparkModel,
  };
}

export function getPublicHealthStatus(customRoot?: string): ApiHealthStatus {
  const cfg = getServerConfig(customRoot);
  return {
    ok: true,
    metaConfigured: Boolean(cfg.modelApiKey),
    metaBaseUrl: cfg.metaBaseUrl,
    metaSparkModel: cfg.metaSparkModel,
    keySource: cfg.keySource,
  };
}

export function redactSecrets(input: string, customRoot?: string): string {
  if (!input) return input;
  const cfg = getServerConfig(customRoot);
  let safe = input;
  if (cfg.modelApiKey && cfg.modelApiKey.length >= 6) {
    safe = safe.split(cfg.modelApiKey).join('[REDACTED_MODEL_API_KEY]');
  }
  if (cfg.demoPassword && cfg.demoPassword.length >= 6) {
    safe = safe.split(cfg.demoPassword).join('[REDACTED_DEMO_PASSWORD]');
  }
  safe = safe.replace(/Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [REDACTED]');
  return safe;
}

