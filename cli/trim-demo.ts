import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, extname, join, dirname } from "node:path";
import { parseSleepData } from "../src/data/loadLocalData.js";

const args = process.argv.slice(2);

let file = "";
let startDate: string | undefined;
let endDate: string | undefined;
let outputPath: string | undefined;

for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-o" || arg === "--output") {
        outputPath = args[++i];
    } else if (!file) {
        file = arg;
    } else if (!startDate) {
        startDate = arg;
    } else if (!endDate) {
        endDate = arg;
    }
}

if (!file) {
    console.error(
        "Usage: npx tsx cli/trim-demo.ts <sleep-data.json> [startDate] [endDate] [-o output.json]\n\n" +
            "Creates a lightweight demo dataset from a full sleep data export.\n" +
            "Strips stage-level data and keeps only essential fields for actogram rendering.\n\n" +
            "Date format: YYYY-MM-DD. If omitted, uses first 90 days of data."
    );
    process.exit(1);
}

if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
}

const data: unknown = JSON.parse(readFileSync(file, "utf-8"));
const records = parseSleepData(data);

if (records.length === 0) {
    console.error("No sleep records found in file");
    process.exit(1);
}

const inputSize = statSync(file).size;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const sortedRecords = [...records].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

const firstDate = startDate ? new Date(startDate) : sortedRecords[0]!.startTime;
firstDate.setHours(0, 0, 0, 0);

const lastDate = endDate ? new Date(endDate) : new Date(firstDate.getTime() + 90 * MS_PER_DAY);
lastDate.setHours(23, 59, 59, 999);

if (!endDate && !startDate) {
    console.log(`No date range specified, using first 90 days: ${formatDate(firstDate)} to ${formatDate(lastDate)}`);
} else {
    console.log(`Date range: ${formatDate(firstDate)} to ${formatDate(lastDate)}`);
}

const filtered = sortedRecords.filter((r) => {
    const start = r.startTime.getTime();
    return start >= firstDate.getTime() && start <= lastDate.getTime();
});

if (filtered.length === 0) {
    console.error("No records found in the specified date range");
    process.exit(1);
}

const outputData = {
    sleep: filtered.map((r) => {
        const trimmed: Record<string, unknown> = {
            logId: r.logId,
            dateOfSleep: r.dateOfSleep,
            startTime: r.startTime.toISOString(),
            endTime: r.endTime.toISOString(),
            durationMs: r.durationMs,
            durationHours: r.durationHours,
            efficiency: r.efficiency,
            minutesAsleep: r.minutesAsleep,
            minutesAwake: r.minutesAwake,
            isMainSleep: r.isMainSleep,
        };
        return trimmed;
    }),
};

const json = JSON.stringify(outputData);
const outputSize = Buffer.byteLength(json);

if (outputPath) {
    writeFileSync(outputPath, json);
    console.log(`Written to: ${outputPath}`);
} else {
    const dir = dirname(file);
    const base = basename(file, extname(file));
    const outFile = join(dir, `${base}-demo.json`);
    writeFileSync(outFile, json);
    console.log(`Written to: ${outFile}`);
    outputPath = outFile;
}

const actualDateRange =
    filtered.length > 0
        ? `${formatDate(filtered[0]!.startTime)} — ${formatDate(filtered[filtered.length - 1]!.startTime)}`
        : "N/A";

console.log(`Records: ${filtered.length} (from ${sortedRecords.length} total)`);
console.log(`Date range: ${actualDateRange}`);
console.log(`Input size: ${(inputSize / 1024 / 1024).toFixed(2)} MiB`);
console.log(`Output size: ${(outputSize / 1024).toFixed(1)} KiB`);
console.log(`Reduction: ${((1 - outputSize / inputSize) * 100).toFixed(1)}%`);

function formatDate(d: Date): string {
    return d.toISOString().split("T")[0]!;
}
