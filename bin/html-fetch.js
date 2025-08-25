#!/usr/bin/env node
import { Command } from 'commander';
import { getConfig } from '../src/config/index.js';
import { FetcherService } from '../src/services/fetcherService.js';
import { logger, verbose } from '../src/logger.js';

const program = new Command();
program
  .name('html-fetch')
  .description('Fetch page HTML via HTTP or headless browser, with proxy rotation')
  .argument('<url>', 'The URL to fetch')
  .option('-m, --mode <mode>', 'Mode to use: http|browser')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-o, --output <file>', 'Save output to file')
  .option('-H, --header <header...>', 'Additional request headers, e.g. "Name: Value"', (v, acc) => {
    acc.push(v);
    return acc;
  }, [])
  .action(async (url, options) => {
    try {
      const config = getConfig();
      const fetcher = new FetcherService(config);
      const headers = (options.header || []).reduce((map, line) => {
        const idx = String(line).indexOf(':');
        if (idx > -1) {
          const k = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          if (k) map[k] = val;
        }
        return map;
      }, {});
      const res = await fetcher.fetch(url, { mode: options.mode, headers });
      
      // Handle output
      if (options.output) {
        const fs = await import('fs/promises');
        await fs.writeFile(options.output, res.body || '');
        if (verbose) {
          console.log(`Output saved to: ${options.output}`);
        }
      } else {
        process.stdout.write(res.body || '');
      }
      
      process.exit(0);
    } catch (e) {
      logger.fatal({ err: e.message }, 'CLI fetch failed');
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
