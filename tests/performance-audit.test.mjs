import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPerformanceAuditEnabled,
  logPerformanceAudit,
  measurePerformanceAudit,
  performancePayloadBytes,
} from "../lib/performance-audit.ts";

test("production disables metrics and avoids serialization", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousInfo = console.info;
  let logged = false;
  let serialized = false;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    console.info = () => { logged = true; };
    const value = { get secret() { serialized = true; return "never-read"; } };
    assert.equal(isPerformanceAuditEnabled(), false);
    assert.equal(performancePayloadBytes(value), undefined);
    assert.equal(await measurePerformanceAudit("inventory", "total", async () => 42), 42);
    logPerformanceAudit({ loader: "inventory", phase: "total", durationMs: 2 });
    assert.equal(logged, false);
    assert.equal(serialized, false);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
    console.info = previousInfo;
  }
});

test("Preview emits only the supplied structural metrics", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousInfo = console.info;
  const logs = [];
  try {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    console.info = (line) => logs.push(JSON.parse(line));
    const result = await measurePerformanceAudit("inbound", "total", async () => ({ rows: 3 }), () => ({ queryCount: 2, rowCount: 3 }));
    assert.deepEqual(result, { rows: 3 });
    assert.equal(logs.length, 1);
    assert.deepEqual(Object.keys(logs[0]).sort(), ["durationMs", "event", "loader", "phase", "queryCount", "rowCount"].sort());
    assert.equal(logs[0].event, "nk_performance_audit");
    assert.equal(logs[0].queryCount, 2);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
    console.info = previousInfo;
  }
});
