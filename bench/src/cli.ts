import { Command } from "commander";
import cliProgress from "cli-progress";
import chalk from "chalk";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { runBenchmark, mergeResultFiles } from "./runner.js";
import { loadAllSuites, loadSuite } from "./suite-loader.js";
import {
  getAvailableProviders,
  getProviderById,
  getAllProviders,
} from "./providers/index.js";
import { DEFAULT_CONFIG } from "./types.js";
import type { RunnerEvent } from "./runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BENCH_ROOT = resolve(__dirname, "..");
const PROJECT_ROOT = resolve(BENCH_ROOT, "..");

const program = new Command();

program
  .name("stt-bench")
  .description("TypeWhisper Speech-to-Text Benchmark")
  .version("0.1.0");

program
  .command("run", { isDefault: true })
  .description("Run the benchmark")
  .option("-s, --suite <path>", "Run a specific test suite")
  .option("-p, --provider <id>", "Run only a specific provider")
  .option("-l, --language <lang>", "Filter suites by language")
  .option("-v, --version <version>", "Version label")
  .option(
    "-r, --runs <number>",
    "Runs per model",
    String(DEFAULT_CONFIG.runsPerModel)
  )
  .action(async (opts) => {
    console.log(chalk.bold("\nTypeWhisper STT Benchmark\n"));

    // Default version to today's date
    const version =
      opts.version || new Date().toISOString().slice(0, 10);

    // Load suites
    let suites;
    if (opts.suite) {
      suites = [await loadSuite(opts.suite)];
    } else {
      suites = await loadAllSuites(join(BENCH_ROOT, "tests"));
    }

    if (opts.language) {
      suites = suites.filter(
        (s) => s.language === opts.language
      );
    }

    if (suites.length === 0) {
      console.log(chalk.red("No test suites found."));
      process.exit(1);
    }

    const testCount = suites.reduce(
      (sum, s) => sum + s.tests.length,
      0
    );
    console.log(
      chalk.dim(
        `Loaded ${suites.length} suite(s) with ${testCount} test(s)`
      )
    );

    if (testCount === 0) {
      console.log(
        chalk.yellow(
          "\nNo test cases found in suites. Add audio test cases first."
        )
      );
      process.exit(0);
    }

    // Find providers
    let providers = await getAvailableProviders();
    if (opts.provider) {
      const p = getProviderById(opts.provider);
      if (!p) {
        console.log(
          chalk.red(`Provider "${opts.provider}" not found.`)
        );
        process.exit(1);
      }
      providers = [p];
    }

    if (providers.length === 0) {
      console.log(
        chalk.red(
          "No providers available. Set API keys: OPENAI_API_KEY, DEEPGRAM_API_KEY, GROQ_API_KEY"
        )
      );
      process.exit(1);
    }

    console.log(
      chalk.dim(
        `Providers: ${providers.map((p) => `${p.name} (${p.models.join(", ")})`).join(", ")}`
      )
    );

    // Progress bar
    const bar = new cliProgress.SingleBar(
      {
        format: `${chalk.cyan("{bar}")} {percentage}% | {value}/{total} | {status}`,
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    );

    let completed = 0;
    let totalTests = 0;

    const onEvent = (event: RunnerEvent) => {
      if (event.type === "plan") {
        totalTests = event.totalTests;
        bar.start(totalTests, 0, { status: "starting..." });
      } else if (event.type === "done" || event.type === "error") {
        completed++;
        bar.update(completed, {
          status: `${event.providerId}/${event.model}`,
        });
      }
    };

    const config = {
      ...DEFAULT_CONFIG,
      runsPerModel:
        parseInt(opts.runs) || DEFAULT_CONFIG.runsPerModel,
    };

    console.log(
      chalk.dim(
        `\n${config.runsPerModel} run(s) per model, ${config.maxConcurrency} concurrent\n`
      )
    );

    const summary = await runBenchmark({
      suites,
      providers,
      config,
      version,
      onEvent,
    });

    bar.stop();

    // Print rankings
    console.log(chalk.bold("\nResults:\n"));
    console.log(
      chalk.dim(
        "Rank  Model                          WER(norm)  CER      RTF      Cost/h"
      )
    );
    console.log(chalk.dim("-".repeat(80)));

    summary.rankings.forEach((r, i) => {
      const rank = String(i + 1).padStart(4);
      const model = `${r.providerId}/${r.model}`.padEnd(30);
      const wer =
        (r.avgWerNormalized * 100).toFixed(1).padStart(8) + "%";
      const cer = (r.avgCer * 100).toFixed(1).padStart(6) + "%";
      const rtf = r.avgRealtimeFactor.toFixed(3).padStart(8);
      const cost =
        r.costPerHourAudio != null
          ? "$" + r.costPerHourAudio.toFixed(2).padStart(6)
          : "   free";

      const color =
        i === 0
          ? chalk.green
          : i === 1
            ? chalk.blue
            : i === 2
              ? chalk.yellow
              : chalk.white;
      console.log(
        color(`${rank}  ${model} ${wer} ${cer} ${rtf} ${cost}`)
      );
    });

    console.log(
      chalk.dim(
        `\nResults saved to ${config.outputDirectory}/${version}/`
      )
    );
  });

program
  .command("providers")
  .description("List available providers")
  .action(async () => {
    console.log(chalk.bold("\nSTT Providers:\n"));
    const all = getAllProviders();
    for (const p of all) {
      const available = await p.isAvailable();
      const status = available
        ? chalk.green("available")
        : chalk.red("unavailable");
      console.log(
        `  ${chalk.bold(p.name)} (${p.id}) [${p.type}] - ${status}`
      );
      console.log(`    Models: ${p.models.join(", ")}`);
    }
    console.log();
  });

program
  .command("merge")
  .description("Merge per-model result files into benchmark-results.json")
  .action(async () => {
    await mergeResultFiles(PROJECT_ROOT);
    console.log(chalk.green("Merged results into visualizer/public/data/benchmark-results.json"));
  });

program.parse();
