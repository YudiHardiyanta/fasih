const puppeteer = require("puppeteer");
const { createClient } = require("@clickhouse/client");
const fs = require('fs');
const path = require('path');


require("dotenv").config();

const LOGIN_URL = "https://fasih-sm.bps.go.id/oauth2/authorization/ics";
const ASSIGNMENT_URL = "https://fasih-sm.bps.go.id/analytic/api/v2/assignment/datatable-all-user-survey-periode";
const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || "600000", 10);
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT || "600000", 10);
const MAX_DOWNLOAD_RETRY = parseInt(process.env.MAX_DOWNLOAD_RETRY || "3", 10);
const ASSIGNMENT_TABLE_NAME = getTableNameFromEnv("ASSIGNMENT_TABLE_NAME", "assignments");
const SURVEY_TABLE_NAME = getTableNameFromEnv("SURVEY_TABLE_NAME", "surveys");
const REGION_GROUP_TABLE_NAME = getTableNameFromEnv("REGION_GROUP_TABLE_NAME", "region_groups");

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

function toJson(value, defaultValue) {
    if (value === undefined || value === null) {
        return JSON.stringify(defaultValue);
    }

    return typeof value === "string" ? value : JSON.stringify(value);
}

function toUInt8(value) {
    if (value === null || value === undefined) {
        return null;
    }

    return value ? 1 : 0;
}

function getRegionLevelFullCode(region, level) {
    try {
        const data = typeof region === "string" ? JSON.parse(region) : region;
        let current = data;

        for (let i = 1; i <= level; i++) {
            current = current?.[`level${i}`];
            if (!current) {
                return null;
            }
        }

        return current.fullCode || null;
    } catch (error) {
        return null;
    }
}

function assignmentRow(data) {
    return {
        id: data.id,
        surveyPeriodId: data.surveyPeriodId || null,
        mode: toJson(data.mode, null),
        assignmentErrorStatusType: data.assignmentErrorStatusType ?? null,
        userIdResponsibility: data.userIdResponsibility || null,
        approvedByCreator: toUInt8(data.approvedByCreator),
        codeIdentity: data.codeIdentity || null,
        assignmentStatusId: data.assignmentStatusId ?? null,
        assignmentStatusAlias: data.assignmentStatusAlias || null,
        data1: data.data1 || null,
        data2: data.data2 || null,
        data3: data.data3 || null,
        data4: data.data4 || null,
        data5: data.data5 || null,
        data6: data.data6 || null,
        data7: data.data7 || null,
        data8: data.data8 || null,
        data9: data.data9 || null,
        data10: data.data10 || null,
        email: data.email || null,
        dateCreated: toDateTime(data.dateCreated),
        dateModified: toDateTime(data.dateModified),
        isActive: toUInt8(data.isActive),
        done: toUInt8(data.done),
        secondary: toUInt8(data.secondary),
        longitude: data.longitude ?? null,
        latitude: data.latitude ?? null,
        copyFromId: data.copyFromId || null,
        externalDone: toUInt8(data.externalDone),
        currentUserId: data.currentUserId || null,
        currentUserUsername: data.currentUserUsername || null,
        currentUserFullname: data.currentUserFullname || null,
        currentUserSurveyRoleId: data.currentUserSurveyRoleId || null,
        currentUserSurveyRoleName: data.currentUserSurveyRoleName || null,
        currentUserSurveyRoleIsPencacah: toUInt8(data.currentUserSurveyRoleIsPencacah),
        currentUserSurveyRoleCanPullSample: toUInt8(data.currentUserSurveyRoleCanPullSample),
        sourceFrom: data.sourceFrom || null,
        listing: toUInt8(data.listing),
        assignmentResponsibility: toJson(data.assignmentResponsibility, null),
        assignmentResponsibilityAdmin: toJson(data.assignmentResponsibilityAdmin, null),
        region: toJson(data.region, null),
        level_1_fullcode: getRegionLevelFullCode(data.region, 1),
        level_2_fullcode: getRegionLevelFullCode(data.region, 2),
        level_3_fullcode: getRegionLevelFullCode(data.region, 3),
        level_4_fullcode: getRegionLevelFullCode(data.region, 4),
        level_5_fullcode: getRegionLevelFullCode(data.region, 5),
        level_6_fullcode: getRegionLevelFullCode(data.region, 6),
        regionMetadata: toJson(data.regionMetadata, null),
        sampleType: data.sampleType ?? null,
        isTarget: toUInt8(data.isTarget),
        referencedTo: toJson(data.referencedTo, null),
        lockedByUser: toUInt8(data.lockedByUser),
        lockedByAnother: toUInt8(data.lockedByAnother),
        inserted_at: toDateTime(new Date())
    };
}

function uniqueById(rows) {
    const map = new Map();

    for (const row of rows) {
        if (row.id) {
            map.set(row.id, row);
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
        values: uniqueById(rows),
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
        CREATE TABLE IF NOT EXISTS ${ASSIGNMENT_TABLE_NAME}
        (
            id String,
            surveyPeriodId Nullable(String),
            mode Nullable(String),
            assignmentErrorStatusType Nullable(Int32),
            userIdResponsibility Nullable(String),
            approvedByCreator Nullable(UInt8),
            codeIdentity Nullable(String),
            assignmentStatusId Nullable(Int32),
            assignmentStatusAlias Nullable(String),
            data1 Nullable(String),
            data2 Nullable(String),
            data3 Nullable(String),
            data4 Nullable(String),
            data5 Nullable(String),
            data6 Nullable(String),
            data7 Nullable(String),
            data8 Nullable(String),
            data9 Nullable(String),
            data10 Nullable(String),
            email Nullable(String),
            dateCreated Nullable(DateTime),
            dateModified Nullable(DateTime),
            isActive Nullable(UInt8),
            done Nullable(UInt8),
            secondary Nullable(UInt8),
            longitude Nullable(Float64),
            latitude Nullable(Float64),
            copyFromId Nullable(String),
            externalDone Nullable(UInt8),
            currentUserId Nullable(String),
            currentUserUsername Nullable(String),
            currentUserFullname Nullable(String),
            currentUserSurveyRoleId Nullable(String),
            currentUserSurveyRoleName Nullable(String),
            currentUserSurveyRoleIsPencacah Nullable(UInt8),
            currentUserSurveyRoleCanPullSample Nullable(UInt8),
            sourceFrom Nullable(String),
            listing Nullable(UInt8),
            assignmentResponsibility Nullable(String),
            assignmentResponsibilityAdmin Nullable(String),
            region Nullable(String),
            level_1_fullcode Nullable(String),
            level_2_fullcode Nullable(String),
            level_3_fullcode Nullable(String),
            level_4_fullcode Nullable(String),
            level_5_fullcode Nullable(String),
            level_6_fullcode Nullable(String),
            regionMetadata Nullable(String),
            sampleType Nullable(Int32),
            isTarget Nullable(UInt8),
            referencedTo Nullable(String),
            lockedByUser Nullable(UInt8),
            lockedByAnother Nullable(UInt8),
            inserted_at DateTime
        )
        ENGINE = ReplacingMergeTree(inserted_at)
        ORDER BY id
    `
    });

    for (let i = 1; i <= 6; i++) {
        await clickhouse.command({
            query: `
            ALTER TABLE ${ASSIGNMENT_TABLE_NAME}
            ADD COLUMN IF NOT EXISTS level_${i}_fullcode Nullable(String) AFTER region
        `
        });
    }

    await clickhouse.command({
        query: `
        CREATE TABLE IF NOT EXISTS last_data
        (
            id String,
            dateModified Nullable(DateTime),
            inserted_at DateTime
        )
        ENGINE = ReplacingMergeTree(inserted_at)
        ORDER BY id
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

async function downloadAssignmentPage(page, body, xsrfToken) {
    return await page.evaluate(async ({ url, xsrfToken, body, timeout }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const res = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: {
                    "accept": "application/json",
                    "content-type": "application/json",
                    "x-xsrf-token": xsrfToken
                },
                body: JSON.stringify(body),
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
    }, { url: ASSIGNMENT_URL, xsrfToken, body, timeout: FETCH_TIMEOUT });
}

async function downloadAssignmentPageWithRetry(page, body) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRY; attempt++) {
        try {
            const xsrfToken = await getXsrfToken(page);
            if (!xsrfToken) {
                throw new Error("XSRF token tidak ditemukan");
            }

            const result = await downloadAssignmentPage(page, body, xsrfToken);
            if (!result || !Array.isArray(result.searchData)) {
                throw new Error("Data hasil unduh tidak valid");
            }

            return result;
        } catch (error) {
            lastError = error;
            console.log(`Unduh gagal percobaan ${attempt}/${MAX_DOWNLOAD_RETRY}: ${error.message}`);

            if (attempt < MAX_DOWNLOAD_RETRY) {
                console.log("Mencoba login ulang sebelum mengulang unduh");
                await login(page);
            }
        }
    }

    throw lastError;
}

async function crawl() {
    await initializeClickHouse();
    console.log("ClickHouse connected");

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT);

    // 🔐 LOGIN
    await login(page);


    const regionRows = await queryJsonEachRow(`
        SELECT *
        FROM ${REGION_GROUP_TABLE_NAME} FINAL
        LIMIT 1
    `);
    const surveyRows = await queryJsonEachRow(`
        SELECT *
        FROM ${SURVEY_TABLE_NAME} FINAL
        LIMIT 1
    `);

    if (regionRows.length === 0) {
        throw new Error(`Data ${REGION_GROUP_TABLE_NAME} belum ada di ClickHouse. Jalankan master_wilayah.js dulu.`);
    }

    if (surveyRows.length === 0) {
        throw new Error(`Data ${SURVEY_TABLE_NAME} belum ada di ClickHouse. Jalankan master_wilayah.js dulu.`);
    }

    const survey = surveyRows[0];
    const surveyPeriods = survey.surveyPeriods ? JSON.parse(survey.surveyPeriods) : [];

    if (surveyPeriods.length === 0 && !process.env.SURVEY_PERIOD_ID) {
        throw new Error("surveyPeriods kosong. Isi SURVEY_PERIOD_ID di .env atau jalankan master_wilayah.js ulang.");
    }

    let survey_periode_id = surveyPeriods[0]?.id;
    if (process.env.SURVEY_PERIOD_ID) {
        survey_periode_id = process.env.SURVEY_PERIOD_ID;
    }
    // 🔥 ambil tasks

    let sql = fs.readFileSync(
        path.join(__dirname, 'region_join.sql'),
        'utf-8'
    );
    let offset = 0;

    try {
        const index_main = fs.readFileSync(
            path.join(__dirname, 'index_main.txt'),
            'utf-8'
        );

        offset = parseInt(index_main.trim(), 10);
        if (isNaN(offset)) offset = 0;

    } catch (e) {
        offset = 0;
    }

    sql = sql + ` OFFSET ${offset}`;
    const tasks = await queryJsonEachRow(sql);
    const cliProgress = require('cli-progress');

    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    const total = tasks.length;
    bar.start(total, 0);
    let latestDateModified = null;
    // loop
    for (const task of tasks) {
        const body = {
            draw: 2,
            columns: [
                { data: "id", name: "", searchable: true, orderable: false, search: { value: "", regex: false } },
                { data: "codeIdentity", name: "", searchable: true, orderable: false, search: { value: "", regex: false } },
                { data: "data1", name: "", searchable: true, orderable: true, search: { value: "", regex: false } },
                { data: "data2", name: "", searchable: true, orderable: true, search: { value: "", regex: false } },
                { data: "data3", name: "", searchable: true, orderable: true, search: { value: "", regex: false } },
                { data: "data4", name: "", searchable: true, orderable: true, search: { value: "", regex: false } },
                { data: "data6", name: "", searchable: true, orderable: true, search: { value: "", regex: false } }
            ],

            order: [{ column: 0, dir: "asc" }],
            start: 0,
            length: 1000,
            search: { value: "", regex: false },

            assignmentExtraParam: {
                region1Id: task['region1Id'],
                region2Id: task['region2Id'],
                region3Id: task['region3Id'],
                region4Id: task['region4Id'],
                region5Id: task['region5Id'],
                region6Id: task['region6Id'],
                region7Id: null,
                region8Id: null,
                region9Id: null,
                region10Id: null,

                surveyPeriodId: survey_periode_id,

                assignmentErrorStatusType: -1,
                assignmentStatusAlias: null,

                data1: null,
                data2: null,
                data3: null,
                data4: null,
                data5: null,
                data6: null,
                data7: null,
                data8: null,
                data9: null,
                data10: null,

                userIdResponsibility: null,
                currentUserId: null,

                regionId: null,
            }
        };
        const result = await downloadAssignmentPageWithRetry(page, body);
        if (result.searchData) {
            for (const assignment of result.searchData) {
                const dateModified = toDateTime(assignment.dateModified);
                if (dateModified && (!latestDateModified || dateModified > latestDateModified)) {
                    latestDateModified = dateModified;
                }
            }
            await insertJsonEachRow(ASSIGNMENT_TABLE_NAME, result.searchData.map(assignmentRow));
        }

        bar.increment();
        fs.writeFileSync('index_main.txt', (offset+bar.value).toString());
    }
    bar.stop();
    console.log("Selesai download semua level");
    if (latestDateModified) {
        await insertJsonEachRow("last_data", [{
            id: survey_periode_id,
            dateModified: latestDateModified,
            inserted_at: toDateTime(new Date())
        }]);
    }
    // await optimizeTable(ASSIGNMENT_TABLE_NAME);
    // await optimizeTable("last_data");
    // update last_data
    if (fs.existsSync('index_main.txt')) {
        fs.unlinkSync('index_main.txt');
    }
    await browser.close();
}

//crawl()

const cron = require("node-cron");

cron.schedule("0 10,16 * * *", () => {
    const now = new Date();
    console.log(`Cron job triggered at ${now.toLocaleString()}`);
    crawl();
});
