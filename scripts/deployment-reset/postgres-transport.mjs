// Transport for the existing, guarded PowerShell procedure. Never binds SQL.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLocalDockerTransport, validateTargets, remoteArgs, ref, image, sanitizedChildEnv } from '../deployment-backup.mjs';

export async function createResetDockerTransport(environmentName, { env = process.env, launch = spawn } = {}) {
  const sanitized = sanitizedChildEnv(env);
  for (const name of Object.keys(sanitized)) if (name.toUpperCase() === environmentName.toUpperCase()) delete sanitized[name];
  const execute = async (args, input, command) => {
    const p = launch(command, args, { env: sanitized, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    const output = [];
    p.stdout.on('data', chunk => output.push(chunk));
    p.stderr.on('data', () => {}); // Never emit source-specific stderr/DSN.
    const completion = new Promise((yes,no) => { p.on('error',()=>no(new Error('RESET_LOCAL_TOOL_FAILED'))); p.on('close',code=>code===0?yes():no(new Error('RESET_LOCAL_TOOL_FAILED'))); });
    p.stdin.end(input);
    await completion;
    return { bytes: Buffer.concat(output) };
  };
  // Keep override checks against the original env; all child paths are sanitized.
  return createLocalDockerTransport({ env, execute, startProcess: (command,args,options)=>launch(command,args,{...options,env:sanitized}) });
}

export function resetTransportArgs(mode, sql) {
  if (!['DryRun','Execute'].includes(mode)) throw new Error('RESET_MODE_INVALID');
  const prefix = sql.replace(/^\\set ON_ERROR_STOP on\r?\n\s*/, '');
  const expected = mode === 'DryRun' ? /^begin transaction isolation level repeatable read read only;/i : /^begin;/i;
  if (!expected.test(prefix)) throw new Error('RESET_TRANSACTION_PREFIX_INVALID');
  const args = remoteArgs('psql', ['-X','-qAt','-v','ON_ERROR_STOP=1','-f','-']);
  if (mode === 'Execute') {
    const shellIndex = args.indexOf('-c') + 1;
    args[shellIndex] = args[shellIndex].replace('default_transaction_read_only=on','default_transaction_read_only=off');
  }
  return args;
}

export async function runResetTransport({ mode, sql, databaseUrl, transport }) {
  const args = resetTransportArgs(mode, sql);
  const credentials = validateTargets(databaseUrl, `https://${ref}.supabase.co`);
  // Only metadata precedes transport. Pin is also used by run(), including psql.
  await transport.run(['image','inspect','--format','{{.Id}}',image]);
  const version = await transport.run(['run','--pull=never','--rm','--network','none','--entrypoint','psql',image,'--version']);
  if (version.bytes.toString().trim() !== 'psql (PostgreSQL) 17.6') throw new Error('RESET_CLIENT_VERSION_INVALID');
  return (await transport.run(args, credentials + sql)).bytes.toString('utf8');
}

async function main() {
  const [mode, environmentName, ...extra] = process.argv.slice(2);
  if (extra.length || !/^[A-Z][A-Z0-9_]*$/.test(environmentName ?? '')) throw new Error('RESET_ENV_NAME_INVALID');
  const chunks = [];
  for await (const chunk of process.stdin) { chunks.push(chunk); if (chunks.reduce((n,b)=>n+b.length,0) > 2000000) throw new Error('RESET_SQL_TOO_LARGE'); }
  const sql = Buffer.concat(chunks).toString('utf8');
  const databaseUrl = process.env[environmentName];
  const output = await runResetTransport({ mode, sql, databaseUrl, transport: await createResetDockerTransport(environmentName) });
  process.stdout.write(output);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('RESET_TRANSPORT_ABORTED — raw details suppressed; commit state must be independently verified.'); process.exitCode = 1; });
