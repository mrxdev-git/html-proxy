#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('html-proxy')
  .description('Start the Node HTML Receiver server')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-p, --port <port>', 'Port to listen on', '3456')
  .option('-m, --mode <mode>', 'Default fetching mode (http|browser|crawlee-http|crawlee-browser|adaptive)', 'adaptive')
  .parse(process.argv);

const options = program.opts();

// Set environment variables based on options
const env = { ...process.env };

if (options.verbose) {
  env.VERBOSE = 'true';
}

if (options.port) {
  env.PORT = options.port;
}

if (options.mode) {
  env.DEFAULT_MODE = options.mode;
}

// Start the server
const serverPath = path.join(__dirname, 'index.js');
const child = spawn('node', [serverPath], {
  env,
  stdio: 'inherit'
});

// Handle process termination
process.on('SIGINT', () => {
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});

child.on('exit', (code) => {
  process.exit(code);
});
