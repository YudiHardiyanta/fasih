const puppeteer = require("puppeteer");
const { createClient } = require("@clickhouse/client");

require("dotenv").config();

const LOGIN_URL = "https://fasih-sm.bps.go.id/oauth2/authorization/ics";
const ALLOCATION_URL = "https://fasih-sm.bps.go.id/app/api/survey-user/api/v1/allocations-view/by-user";
const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || "600000", 10);
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT || "600000", 10);
const MAX_DOWNLOAD_RETRY = parseInt(process.env.MAX_DOWNLOAD_RETRY || "3", 10);
const PAGE_SIZE = parseInt(process.env.ALLOCATION_PAGE_SIZE || "1000", 10);
const LEVEL_2_TABLE_NAME = getTableNameFromEnv("LEVEL_2_TABLE_NAME", "level_2");
const ALLOCATION_TABLE_NAME = getTableNameFromEnv("ALLOCATION_TABLE_NAME_1", "allocations_by_user");

const clickhouse = createClient({
    url: `http://${process.env.CLICKHOUSE_HOST || "localhost"}:${process.env.CLICKHOUSE_PORT || "8123"}`,
    database: process.env.CLICKHOUSE_DB || "analytics",
    username: process.env.CLICKHOUSE_USER || "analyst",
    password: process.env.CLICKHOUSE_PASSWORD || "analyst_password"
});

function getTableNameFromEnv(envName, defaultValue) {
    const tableName = process.env[envName] || defaultValue;

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
        throw new Error(`${envName} hanya boleh berisi huruf, angka, dan underscore, serta tidak boleh diawali angka.`);
    }

    return tableName;
}

function requireEnv(envName) {
    const value = process.env[envName];

    if (!value) {
        throw new Error(`${envName} wajib diisi di .env`);
    }

    return value;
}

function toDateTime(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().slice(0, 19).replace("T", " ");
}

function allocationRows(data) {
    const regions = Array.isArray(data.regions) ? data.regions : [];

    return regions.map(region => ({
        email: data.email || "",
        roleName: data.roleName || "",
        regionCode: region.regionCode || "",
        regionName: region.regionName || null,
        level: region.level ?? null,
        allocationId: region.allocationId || "",
        inserted_at: toDateTime(new Date())
    }));
}

function uniqueRows(rows) {
    const map = new Map();

    for (const row of rows) {
        const key = `${row.email}|${row.roleName}|${row.allocationId}|${row.regionCode}`;
        if (row.regionCode || row.allocationId) {
            map.set(key, row);
        }
    }

    return Array.from(map.values());
}

async function insertJsonEachRow(tableName, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return;
    }

    await clickhouse.insert({
        table: tableName,
        values: uniqueRows(rows),
        format: "JSONEachRow"
    });
}

async function queryJsonEachRow(query) {
    const result = await clickhouse.query({
        query,
        format: "JSONEachRow"
    });

    return await result.json();
}

async function initializeClickHouse() {
    await clickhouse.command({
        query: `
        CREATE TABLE IF NOT EXISTS ${ALLOCATION_TABLE_NAME}
        (
            email String,
            roleName String,
            regionCode String,
            regionName Nullable(String),
            level Nullable(Int32),
            allocationId String,
            inserted_at DateTime
        )
        ENGINE = ReplacingMergeTree(inserted_at)
        ORDER BY (allocationId, regionCode, email, roleName)
    `
    });

    await clickhouse.command({
        query: `
        ALTER TABLE ${ALLOCATION_TABLE_NAME}
        ADD COLUMN IF NOT EXISTS regionCode Nullable(String) AFTER roleName
    `
    });

    await clickhouse.command({
        query: `
        ALTER TABLE ${ALLOCATION_TABLE_NAME}
        ADD COLUMN IF NOT EXISTS regionName Nullable(String) AFTER regionCode
    `
    });

    await clickhouse.command({
        query: `
        ALTER TABLE ${ALLOCATION_TABLE_NAME}
        ADD COLUMN IF NOT EXISTS level Nullable(Int32) AFTER regionName
    `
    });

    await clickhouse.command({
        query: `
        ALTER TABLE ${ALLOCATION_TABLE_NAME}
        ADD COLUMN IF NOT EXISTS allocationId Nullable(String) AFTER level
    `
    });
}

async function optimizeTable(tableName) {
    console.log(`Optimize ${tableName}`);
    await clickhouse.command({
        query: `OPTIMIZE TABLE ${tableName} FINAL`
    });
}

async function login(page) {
    console.log("Login ke Fasih SM");
    await page.goto(LOGIN_URL, {
        waitUntil: "networkidle2",
        timeout: PAGE_TIMEOUT
    });

    const usernameInput = await page.$("#username");
    if (!usernameInput) {
        console.log("Sesi Fasih SM masih aktif");
        return;
    }

    await page.type("#username", process.env.USERNAME_COMMUNITY);
    await page.type("#password", process.env.PASSWORD_COMMUNITY);

    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT }),
        page.click("#kc-login")
    ]);
}

async function getXsrfToken(page) {
    const cookies = await page.cookies();
    const xsrfCookie = cookies.find(c => c.name === "XSRF-TOKEN");
    return xsrfCookie ? decodeURIComponent(xsrfCookie.value) : null;
}

async function downloadAllocationPage(page, params, xsrfToken) {
    return await page.evaluate(async ({ url, params, xsrfToken, timeout }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const searchParams = new URLSearchParams({
            surveyRoleId: params.surveyRoleId,
            surveyPeriodId: params.surveyPeriodId,
            page: String(params.page),
            size: String(params.size),
            regionCode: params.regionCode
        });

        try {
            const res = await fetch(`${url}?${searchParams.toString()}`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "accept": "application/json",
                    "x-xsrf-token": xsrfToken
                },
                signal: controller.signal
            });

            const text = await res.text();
            let data = null;

            try {
                data = text ? JSON.parse(text) : null;
            } catch (error) {
                throw new Error(`Response bukan JSON. HTTP ${res.status}`);
            }

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            return data;
        } finally {
            clearTimeout(timer);
        }
    }, { url: ALLOCATION_URL, params, xsrfToken, timeout: FETCH_TIMEOUT });
}

async function downloadAllocationPageWithRetry(page, params) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRY; attempt++) {
        try {
            const xsrfToken = await getXsrfToken(page);
            if (!xsrfToken) {
                throw new Error("XSRF token tidak ditemukan");
            }

            const result = await downloadAllocationPage(page, params, xsrfToken);
            if (!result || !result.data || !Array.isArray(result.data.content)) {
                throw new Error("Data hasil unduh tidak valid");
            }

            return result;
        } catch (error) {
            lastError = error;
            console.log(`Unduh alokasi ${params.regionCode} page ${params.page} gagal percobaan ${attempt}/${MAX_DOWNLOAD_RETRY}: ${error.message}`);

            if (attempt < MAX_DOWNLOAD_RETRY) {
                console.log("Mencoba login ulang sebelum mengulang unduh alokasi");
                await login(page);
            }
        }
    }

    throw lastError;
}

async function getLevel2RegionCodes() {
    const rows = await queryJsonEachRow(`
        SELECT DISTINCT coalesce(nullIf(fullCode, ''), code) AS regionCode
        FROM ${LEVEL_2_TABLE_NAME} FINAL
        WHERE coalesce(nullIf(fullCode, ''), code) IS NOT NULL
        ORDER BY regionCode
    `);

    return rows.map(row => row.regionCode).filter(Boolean);
}

async function crawl() {
    const surveyPeriodId = requireEnv("SURVEY_PERIOD_ID");
    const surveyRoleId = requireEnv("SURVEY_ROLE_ID_1");

    await initializeClickHouse();
    console.log("ClickHouse connected");

    const regionCodes = await getLevel2RegionCodes();
    if (regionCodes.length === 0) {
        throw new Error(`Data ${LEVEL_2_TABLE_NAME} belum ada di ClickHouse. Jalankan master_wilayah.js dulu.`);
    }

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT);

    await login(page);

    const cliProgress = require("cli-progress");
    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar.start(regionCodes.length, 0);

    for (const regionCode of regionCodes) {
        let currentPage = 0;

        while (true) {
            const params = {
                surveyRoleId,
                surveyPeriodId,
                page: currentPage,
                size: PAGE_SIZE,
                regionCode
            };
            const result = await downloadAllocationPageWithRetry(page, params);
            const content = result.data.content || [];

            await insertJsonEachRow(
                ALLOCATION_TABLE_NAME,
                content.flatMap(allocationRows)
            );

            const isLastPage = result.data.last === true || content.length < PAGE_SIZE;
            if (isLastPage) {
                break;
            }

            currentPage++;
        }

        bar.increment();
    }

    bar.stop();
    console.log("Selesai download semua alokasi");
    await optimizeTable(ALLOCATION_TABLE_NAME);
    await browser.close();
    await clickhouse.close();
}

crawl().catch(async (error) => {
    console.error(error);
    await clickhouse.close();
    process.exit(1);
});
