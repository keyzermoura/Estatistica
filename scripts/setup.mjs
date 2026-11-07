#!/usr/bin/env node
/**
 * Preparação e verificação do ValidaMétodo.
 *
 * Executa, em sequência:
 *   1. checagem da versão do Node.js;
 *   2. instalação das dependências;
 *   3. verificação de tipos;
 *   4. testes de referência do núcleo estatístico;
 *   5. build de produção.
 *
 * Uso: npm run setup
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const MIN_NODE_MAJOR = 18;
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

function log(message) {
  console.log(`\n\u001b[36m▸ ${message}\u001b[0m`);
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    log(label);
    const child = isWindows
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], {
          stdio: 'inherit',
          env: process.env,
        })
      : spawn(command, args, {
          stdio: 'inherit',
          env: process.env,
        });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} falhou (código ${code}).`));
    });
  });
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    console.error(
      `Node.js ${MIN_NODE_MAJOR}+ é necessário; versão atual: ${process.versions.node}.`,
    );
    process.exit(1);
  }

  console.log('ValidaMétodo — preparação do ambiente');
  console.log(`Node.js ${process.versions.node} · ${process.platform}`);

  try {
    await run(npm, ['install'], 'Instalando dependências');
    await run(npm, ['run', 'typecheck'], 'Verificando tipos');
    await run(npm, ['test'], 'Executando testes estatísticos');
    await run(npm, ['run', 'build'], 'Gerando build de produção');
    console.log('\n\u001b[32m✓ Ambiente pronto.\u001b[0m');
    console.log('Inicie com: npm run dev');
  } catch (error) {
    console.error(`\n\u001b[31m✗ ${error.message}\u001b[0m`);
    process.exit(1);
  }
}

main();
