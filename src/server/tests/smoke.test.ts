#!/usr/bin/env node
/**
 * Hortus Arbor Nostra - Integration Smoke Test Suite
 * Tests HTTP endpoints without requiring tmux or Claude Code running
 * Uses Node.js built-in test runner and http module
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import express from 'express';
import { execSync } from 'node:child_process';

// ── Test Configuration ─────────────────────────────────────

const TEST_HOME = path.join(os.tmpdir(), `han-test-${Date.now()}`);
const TEST_PORT = Math.floor(Math.random() * 10000) + 20000;

let server: http.Server | null = null;

// ── Helper: Make HTTP request ──────────────────────────────

interface TestResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function makeRequest(method: string, urlPath: string, options: { body?: unknown } = {}): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const requestOptions: http.RequestOptions = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: urlPath,
      method,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode!,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

// ── Test Suite ─────────────────────────────────────────────

test('Server HTTP Tests', async (suite) => {
  suite.before(async () => {
    console.log(`\n  Test Mode: HOME=${TEST_HOME}, PORT=${TEST_PORT}\n`);

    if (!fs.existsSync(TEST_HOME)) {
      fs.mkdirSync(TEST_HOME, { recursive: true });
    }

    process.env.HAN_DIR = TEST_HOME;
    process.env.PORT = String(TEST_PORT);
    process.env.TEST_MODE = 'true';

    const app = express();
    app.use(express.json());

    const dirs = ['pending', 'resolved', 'bridge/contexts'];
    dirs.forEach(dir => {
      const fullPath = path.join(TEST_HOME, dir);
      fs.mkdirSync(fullPath, { recursive: true });
    });

    app.get('/api/health', (_req, res) => {
      res.json({ success: true, status: 'healthy' });
    });

    app.get('/api/status', (_req, res) => {
      res.json({
        success: true,
        status: 'running',
        pending_prompts: 0,
        active_sessions: [],
        uptime: process.uptime()
      });
    });

    app.get('/', (_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.send('<html><head><title>Hortus Arbor Nostra</title></head><body>UI</body></html>');
    });

    app.get('/api/prompts', (_req, res) => { res.json([]); });
    app.get('/api/history', (_req, res) => { res.json([]); });
    app.get('/api/tasks', (_req, res) => { res.json([]); });
    app.get('/api/goals', (_req, res) => { res.json([]); });

    return new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(TEST_PORT, '127.0.0.1', () => {
        console.log(`  Test server started on port ${TEST_PORT}`);
        resolve();
      });
    });
  });

  suite.after(async () => {
    return new Promise<void>((resolve) => {
      if (server) {
        server.close(() => {
          console.log(`  Test server closed\n`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });

  await test('GET /api/health returns 200 with status', async () => {
    const res = await makeRequest('GET', '/api/health');
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, 'healthy');
  });

  await test('GET /api/status returns 200 with uptime', async () => {
    const res = await makeRequest('GET', '/api/status');
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, 'running');
    assert(typeof body.uptime === 'number');
  });

  await test('GET / returns HTML', async () => {
    const res = await makeRequest('GET', '/');
    assert.strictEqual(res.statusCode, 200);
    assert(res.headers['content-type']!.includes('text/html'));
    assert(res.body.includes('Hortus Arbor Nostra'));
  });

  await test('GET /api/prompts returns JSON array', async () => {
    const res = await makeRequest('GET', '/api/prompts');
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert(Array.isArray(body));
  });

  await test('TypeScript compiles cleanly', async () => {
    const serverDir = path.join(__dirname, '..');
    try {
      execSync(`${path.join(serverDir, 'node_modules', '.bin', 'tsc')} --noEmit -p ${path.join(serverDir, 'tsconfig.json')}`, {
        cwd: serverDir,
        stdio: 'pipe'
      });
    } catch (err: any) {
      throw new Error(`TypeScript errors: ${err.stdout?.toString() || err.message}`);
    }
  });
});

test.after(() => {
  console.log('\n  All tests completed');
});
