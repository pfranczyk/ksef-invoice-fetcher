#!/usr/bin/env node
/**
 * Punkt wejścia CLI @logrox/ksef
 */
import { readFileSync } from 'node:fs';
import { Command, CommanderError, Help } from 'commander';
import type { TGlobalOpts } from './commands/_shared.ts';
import { fetchCmd, type TFetchOpts } from './commands/fetch.ts';
import { initCmd } from './commands/init.ts';
import { intervalCmd } from './commands/interval.ts';
import { loginCmd } from './commands/login.ts';
import { marginCmd } from './commands/margin.ts';
import { pdfCmd, type TPdfOpts } from './commands/pdf.ts';
import logger from './utils/logger.ts';

/**
 * Numer wersji CLI czytany z `package.json` (jedno źródło prawdy). `../package.json`
 * rozwiązuje się do korzenia paczki zarówno z `src/index.ts` (build), jak i
 * `dist/index.js` (runtime) — oba leżą jeden poziom pod korzeniem.
 */
const PACKAGE_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    readonly version: string;
  }
).version;

/**
 * Tłumaczy komunikat błędu Commandera na język polski.
 * @param {CommanderError} err - Błąd zgłoszony przez Commandera
 * @returns {string} Komunikat po polsku (bez prefiksu "error: ")
 */
function translateCommanderError(err: CommanderError): string {
  const raw: string = err.message.replace(/^error:\s*/, '');
  switch (err.code) {
    case 'commander.missingArgument':
      return raw.replace(/^missing required argument '(.+?)'$/, "Brak wymaganego argumentu '$1'.");
    case 'commander.missingMandatoryOptionValue':
      return raw.replace(/^required option '(.+?)' not specified$/, "Brak wymaganej opcji '$1'.");
    case 'commander.optionMissingArgument':
      return raw.replace(/^option '(.+?)' argument missing$/, "Brak wartości dla opcji '$1'.");
    case 'commander.unknownOption':
      return raw.replace(/^unknown option '(.+?)'$/, "Nieznana opcja '$1'.");
    case 'commander.unknownCommand':
      return raw.replace(/^unknown command '(.+?)'$/, "Nieznana komenda '$1'.");
    case 'commander.excessArguments':
      // Po liczbie otrzymanych argumentów Commander dokleja listę nadmiarowych
      // wartości po dwukropku (`: a, b`) — dopuszczamy ten sufiks opcjonalnie.
      return raw.replace(
        /^too many arguments for '(.+?)'\. Expected (\d+) argument(s?) but got (\d+)(?::.*)?\.$/,
        "Za dużo argumentów dla '$1'. Oczekiwano $2, otrzymano $4.",
      );
    case 'commander.invalidArgument':
      return raw
        .replace(/^option '(.+?)' argument '(.+?)' is invalid\.\s*(.*)$/, "Nieprawidłowa wartość '$2' opcji '$1'. $3")
        .replace(
          /^command-argument value '(.+?)' is invalid for argument '(.+?)'\.\s*(.*)$/,
          "Nieprawidłowa wartość '$1' argumentu '$2'. $3",
        )
        .trimEnd();
    default:
      return raw;
  }
}

/**
 * Kody błędów Commandera, dla których ma się pojawić help konkretnej subkomendy
 * zamiast globalnej sugestii `ksef --help`.
 */
const SUBCOMMAND_HELP_ERROR_CODES = new Set<string>([
  'commander.missingArgument',
  'commander.missingMandatoryOptionValue',
  'commander.optionMissingArgument',
  'commander.invalidArgument',
  'commander.excessArguments',
  'commander.unknownOption',
]);

/**
 * Znajduje subkomendę z process.argv: pierwszy token nie będący flagą,
 * który pasuje nazwą do jednej z zarejestrowanych subkomend.
 * @returns {Command | undefined} Znaleziona subkomenda lub undefined
 */
function findInvokedSubcommand(): Command | undefined {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('-')) continue;
    const cmd = program.commands.find((c) => c.name() === arg);
    if (cmd !== undefined) return cmd;
  }
  return undefined;
}

/**
 * Handler dla SIGINT (Ctrl+C) — czyste zamknięcie.
 * @returns {void}
 */
function handleShutdown(): void {
  logger.info('\nAplikacja przerwana przez użytkownika');
  logger.info('Zamykanie aplikacji');
  process.exitCode = 0;
}

process.on('SIGINT', handleShutdown);

const program = new Command();

program
  .name('ksef')
  .description('CLI do pobierania faktur i generowania PDF z KSeF API 2.0')
  .version(PACKAGE_VERSION, '-V, --version', 'wyświetla numer wersji')
  .helpOption('-h, --help', 'wyświetla pomoc komendy')
  .helpCommand(false)
  .option('-v, --verbose', 'Tryb debug (szczegółowe logi)')
  .exitOverride()
  .configureOutput({
    outputError: (): void => {},
  })
  .configureHelp({
    subcommandTerm(cmd): string {
      const args = cmd.registeredArguments
        .map((arg) => {
          const name = arg.name() + (arg.variadic === true ? '...' : '');
          return arg.required ? `<${name}>` : `[${name}]`;
        })
        .join(' ');
      const alias = cmd.aliases()[0] !== undefined ? `|${cmd.aliases()[0]}` : '';
      const opts = cmd.options.length > 0 ? ' [opcje]' : '';
      return cmd.name() + alias + opts + (args ? ` ${args}` : '');
    },
    formatHelp(cmd, helper): string {
      const out: string = Help.prototype.formatHelp.call(this, cmd, helper);
      return out
        .replace(/^Usage:/m, 'Użycie:')
        .replace(/^Arguments:/m, 'Argumenty:')
        .replace(/^Options:/m, 'Opcje:')
        .replace(/^Commands:/m, 'Komendy:')
        .replace(/\[options\]/g, '[opcje]')
        .replace(/\[command\]/g, '[komenda]');
    },
  });

program
  .command('help [komenda]')
  .description('wyświetla pomoc dla komendy')
  .action((cmdName: string | undefined): void => {
    if (cmdName === undefined) {
      program.outputHelp();
      return;
    }
    const sub = program.commands.find((c) => c.name() === cmdName);
    if (sub === undefined) {
      throw new CommanderError(1, 'commander.unknownCommand', `error: unknown command '${cmdName}'`);
    }
    sub.outputHelp();
  });

program
  .command('init <nip> [env]')
  .description('Inicjalizuje katalog .ksef/ (env: DEMO|TEST|PRD, domyślnie PRD)')
  .action(async (nip: string, env: string | undefined) => initCmd(nip, env));

program
  .command('login')
  .description('Test autoryzacji w KSeF')
  .action(async () => loginCmd(program.opts<TGlobalOpts>()));

program
  .command('fetch')
  .description('Pobiera faktury XML z zakresu dat')
  .requiredOption('--df <data>', 'Data od (YYYY-MM lub YYYY-MM-DD)')
  .option('--dt <data>', 'Data do (YYYY-MM-DD)')
  .action(async (opts: TFetchOpts) => fetchCmd(opts, program.opts<TGlobalOpts>()));

program
  .command('pdf [miesiąc]')
  .description('Generuje PDF dla miesiąca YYYY-MM (domyślnie: poprzedni miesiąc)')
  .option('--start-day <dzień>', 'Dzień początkowy (1-31)')
  .option('--end-day <dzień>', 'Dzień końcowy (1-31)')
  .action(async (month: string | undefined, opts: TPdfOpts) => pdfCmd(month, opts, program.opts<TGlobalOpts>()));

program
  .command('margin [minuty]')
  .description('Pokaż/ustaw margines odświeżania tokenu JWT (minuty, 0-60)')
  .action(async (minutes: string | undefined) => marginCmd(minutes));

program
  .command('interval [sekundy]')
  .description('Pokaż/ustaw interwał pollingu eksportu (sekundy, 1-300)')
  .action(async (seconds: string | undefined) => intervalCmd(seconds));

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.help' || err.code === 'commander.version') {
      process.exitCode = err.exitCode;
    } else {
      logger.error(translateCommanderError(err));

      const sub = SUBCOMMAND_HELP_ERROR_CODES.has(err.code) ? findInvokedSubcommand() : undefined;
      if (sub !== undefined) {
        process.stderr.write('\n');
        sub.outputHelp({ error: true });
      } else {
        logger.info("Wpisz 'ksef --help' aby zobaczyć dostępne komendy i opcje.");
      }

      process.exitCode = err.exitCode || 1;
    }
  } else {
    const error = err as Error;
    logger.error(`Błąd: ${error.message}`);
    if (error.stack) {
      logger.debug(error.stack);
    }
    process.exitCode = 1;
  }
}
