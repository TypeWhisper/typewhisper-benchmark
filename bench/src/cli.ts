import { Command } from "commander";
import cliProgress from "cli-progress";
import chalk from "chalk";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { runBenchmark, mergeResultFiles } from "./runner.js";
import { rescoreResultFiles } from "./rescore.js";
import {
  acquireSpeedLock,
  describeHolder,
  isReferenceMachine,
  loadSpeedSet,
  machineInfo,
  measureModel,
  readSpeedReport,
  sameMachine,
  speedLanguage,
  speedLockHolder,
  speedResultsDir,
  PUBLISHED_PASSES,
  SPEED_OTHER_RESULTS_DIR,
  writeSpeedReport,
  REFERENCE_MACHINE,
} from "./speed.js";
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
  .option("-s, --suite <paths...>", "Run only these test suite files")
  .option("-p, --provider <id>", "Run only a specific provider")
  .option("-m, --model <name>", "Run only a specific model (requires --provider)")
  .option("-l, --language <lang>", "Filter suites by language")
  .option("-v, --version <version>", "Version label")
  .option(
    "-r, --runs <number>",
    "Runs per model",
    String(DEFAULT_CONFIG.runsPerModel)
  )
  .option(
    "-c, --concurrency <number>",
    "Max concurrent tasks (default: 10 cloud, 1 local)",
  )
  .action(async (opts) => {
    console.log(chalk.bold("\nTypeWhisper STT Benchmark\n"));

    // A run next to a speed measurement would distort its times.
    const speedRun = await speedLockHolder();
    if (speedRun) {
      console.log(chalk.red(`A speed run (${describeHolder(speedRun)}) is measuring; start this run after it finishes.`));
      process.exit(1);
    }

    // Default version to today's date
    const version =
      opts.version || new Date().toISOString().slice(0, 10);

    // Load suites
    let suites;
    if (opts.suite) {
      suites = await Promise.all((opts.suite as string[]).map((path) => loadSuite(path)));
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

    // Filter to a single model if --model is specified
    if (opts.model) {
      if (!opts.provider) {
        console.log(chalk.red("--model requires --provider"));
        process.exit(1);
      }
      const p = providers[0];
      if (!p.models.includes(opts.model)) {
        console.log(
          chalk.red(`Model "${opts.model}" not found in provider "${opts.provider}"`)
        );
        process.exit(1);
      }
      p.models = [opts.model];
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
      } else if (
        event.type === "done" ||
        event.type === "error" ||
        event.type === "skip"
      ) {
        completed++;
        bar.update(completed, {
          status:
            event.type === "skip"
              ? `${event.providerId}/${event.model} (skip)`
              : `${event.providerId}/${event.model}`,
        });
      }
    };

    // Auto-detect concurrency: 1 for local providers, 10 for cloud
    const isLocalOnly = providers.every((p) => p.type === "local" || p.type === "system");
    const defaultConcurrency = isLocalOnly ? 1 : DEFAULT_CONFIG.maxConcurrency;

    const config = {
      ...DEFAULT_CONFIG,
      runsPerModel:
        parseInt(opts.runs) || DEFAULT_CONFIG.runsPerModel,
      maxConcurrency:
        parseInt(opts.concurrency) || defaultConcurrency,
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
  .command("speed")
  .description("Measure the speed of local models, one model and one clip at a time, on the reference machine")
  .option("-p, --provider <id>", "Only this provider (default: every available local provider)")
  .option("-m, --model <names...>", "Only these models (requires --provider)")
  .option("--passes <number>", "Timed passes over the clip set", "3")
  .option("--warmup <number>", "Untimed warm-up clips before the passes", "3")
  .option("--timeout <seconds>", "Timeout per clip", "120")
  .option("--max-load <number>", "Highest 1-minute load average to start a model at", "4")
  .option("--max-wait <minutes>", "How long to wait for an idle machine before a model", "15")
  .option("--settle <seconds>", "Pause before each model once the machine is idle", "5")
  .option("--rerun", "Measure models that already have a speed result for this set and machine")
  .option("--force", "Measure even when the machine does not become idle")
  .option("--allow-other-machine", "Measure on a machine other than the reference Mac mini")
  .action(async (opts) => {
    console.log(chalk.bold("\nTypeWhisper STT speed benchmark\n"));
    const machine = await machineInfo();
    const machineLabel = `${machine.model} · ${machine.chip} · ${machine.memoryGb} GB · ${machine.os}`;
    if (!isReferenceMachine(machine)) {
      const reference = `${REFERENCE_MACHINE.model} · ${REFERENCE_MACHINE.chip} · ${REFERENCE_MACHINE.memoryGb} GB`;
      if (!opts.allowOtherMachine) {
        console.log(chalk.red(`This is ${machineLabel}; published speeds come from ${reference}. Pass --allow-other-machine to measure anyway.`));
        process.exit(1);
      }
      console.log(chalk.yellow(`Not the reference machine (${reference}); results go to ${SPEED_OTHER_RESULTS_DIR}, not the visualizer.`));
    }
    const passes = Math.max(1, parseInt(opts.passes) || PUBLISHED_PASSES);
    if (passes !== PUBLISHED_PASSES) {
      console.log(chalk.yellow(`Published speeds use ${PUBLISHED_PASSES} passes; results go to ${SPEED_OTHER_RESULTS_DIR}, not the visualizer.`));
    }
    const resultsDir = speedResultsDir(machine, passes);
    if (machine.lowPowerMode) console.log(chalk.yellow("Low Power Mode is on; speeds will be lower."));

    let providers = (await getAvailableProviders()).filter((provider) => provider.type !== "cloud");
    if (opts.provider) {
      const provider = getProviderById(opts.provider);
      if (!provider || provider.type === "cloud") {
        console.log(chalk.red(`"${opts.provider}" is not a local provider.`));
        process.exit(1);
      }
      providers = [provider];
    }
    if (opts.model) {
      if (!opts.provider) {
        console.log(chalk.red("--model requires --provider"));
        process.exit(1);
      }
      const unknown = (opts.model as string[]).filter((model) => !providers[0].models.includes(model));
      if (unknown.length) {
        console.log(chalk.red(`Unknown model(s) of ${opts.provider}: ${unknown.join(", ")}`));
        process.exit(1);
      }
    }

    const set = await loadSpeedSet();
    const plan: Array<{ provider: (typeof providers)[number]; model: string }> = [];
    for (const provider of providers) {
      if (provider.speedUnsupported) {
        console.log(chalk.dim(`Skipping ${provider.id}: ${provider.speedUnsupported}`));
        continue;
      }
      for (const model of opts.model ?? provider.models) {
        if (!speedLanguage(provider, model, set.language)) {
          console.log(chalk.dim(`Skipping ${provider.id}/${model}: no supported language`));
          continue;
        }
        const existing = await readSpeedReport(resultsDir, provider.id, model);
        if (!opts.rerun && existing?.speedSet.id === set.id && sameMachine(existing.machine, machine)) {
          console.log(chalk.dim(`Skipping ${provider.id}/${model}: measured ${existing.measuredAt.slice(0, 10)} (--rerun to measure again)`));
          continue;
        }
        plan.push({ provider, model });
      }
    }
    if (plan.length === 0) {
      console.log(chalk.yellow("Nothing to measure."));
      return;
    }

    let release: () => Promise<void>;
    try {
      release = await acquireSpeedLock();
    } catch (error) {
      console.log(chalk.red((error as Error).message));
      process.exit(1);
    }
    const stop = () => {
      void release().finally(() => process.exit(130));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    console.log(
      chalk.dim(
        `${machineLabel}\nSet ${set.id}: ${set.clips.length} clips, ${set.audioSeconds.toFixed(0)} s of audio; ` +
          `${passes} timed pass(es); ${plan.length} model(s), measured one at a time\n`
      )
    );

    const log = (message: string) => console.log(chalk.dim(`  ${message}`));
    const failed: string[] = [];
    try {
      for (const [index, { provider, model }] of plan.entries()) {
        const label = `${provider.id}/${model}`;
        console.log(chalk.bold(`[${index + 1}/${plan.length}] ${label}`));
        const started = Date.now();
        let lastPrint = 0;
        try {
          const report = await measureModel(provider, model, set, {
            passes,
            warmupClips: Math.max(0, parseInt(opts.warmup) || 0),
            timeoutSeconds: Math.max(1, parseInt(opts.timeout) || 120),
            machine,
            settleMs: Math.max(0, Number(opts.settle) || 0) * 1000,
            idle: {
              maxLoad: Number(opts.maxLoad) || 4,
              maxWaitMs: Math.max(0, Number(opts.maxWait) || 0) * 60_000,
              force: Boolean(opts.force),
              log,
            },
            log,
            onClip: (done, total) => {
              if (Date.now() - lastPrint > 15_000 || done === total) {
                lastPrint = Date.now();
                log(`${done}/${total} clips`);
              }
            },
          });
          await writeSpeedReport(resultsDir, report);
          const { summary } = report;
          const wer = summary.wer != null ? `, WER ${(summary.wer * 100).toFixed(1)}%` : "";
          const spread = summary.passSpread > 0.1 ? chalk.yellow(` (passes differ by ${(summary.passSpread * 100).toFixed(0)}%)`) : "";
          console.log(
            chalk.green(
              `  ${summary.speedFactor.toFixed(1)}x real time; short clips ${Math.round(summary.buckets.short.medianMs)} ms, ` +
                `long ${Math.round(summary.buckets.long.medianMs)} ms${wer}`
            ) + spread + chalk.dim(` [${Math.round((Date.now() - started) / 1000)} s]`)
          );
        } catch (error) {
          failed.push(`${label}: ${(error as Error).message}`);
          console.log(chalk.red(`  failed: ${(error as Error).message}`));
        } finally {
          try {
            await provider.release?.(model);
          } catch {
            // The next model's idle check still waits for a lingering worker.
          }
          // Stop the provider's workers, so the next model starts on a quiet machine.
          provider.dispose?.();
        }
      }
    } finally {
      await release();
    }

    if (failed.length) {
      console.log(chalk.red(`\n${failed.length} model(s) failed:`));
      for (const line of failed) console.log(chalk.red(`  ${line}`));
    }
    console.log(chalk.dim(`\nSpeed results in ${resultsDir}`));
    process.exit(failed.length ? 1 : 0);
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
  .command("rescore")
  .description("Recompute the metrics of stored results against the current suite references")
  .option("-s, --suite <ids...>", "Only these suite ids (default: all)")
  .option("--drop-suite <ids...>", "Remove these suites from the result files of --drop-provider")
  .option("--drop-provider <ids...>", "Providers whose --drop-suite results are removed, e.g. cloud APIs that cannot be rerun")
  .action(async (opts) => {
    const suites = await loadAllSuites(join(BENCH_ROOT, "tests"));
    const reports = await rescoreResultFiles(join(PROJECT_ROOT, "visualizer", "public", "data", "results"), suites, {
      suiteIds: opts.suite,
      dropSuites: opts.dropSuite,
      dropProviders: opts.dropProvider,
    });
    for (const report of reports) {
      const dropped = report.dropped.length ? `, dropped ${report.dropped.join(", ")}` : "";
      const refreshed = report.refreshed.length ? `, metadata of ${report.refreshed.join(", ")}` : "";
      console.log(`${report.file}: ${report.changed} result(s) rescored${refreshed}${dropped}`);
    }
    console.log(chalk.green(`${reports.length} result file(s) updated`));
  });

program
  .command("merge")
  .description("Merge per-model result files into benchmark-results.json")
  .action(async () => {
    await mergeResultFiles(PROJECT_ROOT);
    console.log(chalk.green("Merged results into visualizer/public/data/benchmark-results.json"));
  });

program.parse();
