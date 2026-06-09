const puppeteer = require("puppeteer");
const { createClient } = require("@clickhouse/client");
const fs = require('fs');
const path = require('path');


require("dotenv").config();

const LOGIN_URL = "https://fasih-sm.bps.go.id/oauth2/authorization/ics";
const ASSIGNMENT_CONTENT_URL = "https://fasih-sm.bps.go.id/assignment-general/api/assignment/get-by-id-with-data-for-scm";
const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || "600000", 10);
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT || "600000", 10);
const MAX_DOWNLOAD_RETRY = parseInt(process.env.MAX_DOWNLOAD_RETRY || "3", 10);
const ASSIGNMENT_TABLE_NAME = getTableNameFromEnv("ASSIGNMENT_TABLE_NAME", "assignments");
const ASSIGNMENT_CONTENT_TABLE_NAME = getTableNameFromEnv("ASSIGNMENT_CONTENT_TABLE_NAME", "assignment_content");
const USERS_FILE = path.join(__dirname, "users.txt");

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

function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        throw new Error(`File users.txt tidak ditemukan di ${USERS_FILE}`);
    }

    const users = fs.readFileSync(USERS_FILE, "utf-8")
        .split(/\r?\n/)
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(item => item.line && !item.line.startsWith("#"))
        .map(item => {
            const commaIndex = item.line.indexOf(",");
            if (commaIndex === -1) {
                throw new Error(`Format users.txt baris ${item.lineNumber} salah. Gunakan username,password`);
            }

            const username = item.line.slice(0, commaIndex).trim();
            const password = item.line.slice(commaIndex + 1).trim();
            if (!username || !password) {
                throw new Error(`Username/password users.txt baris ${item.lineNumber} tidak boleh kosong`);
            }

            return { username, password };
        });

    if (users.length === 0) {
        throw new Error("File users.txt tidak berisi akun yang valid");
    }

    return users;
}

const loginUsers = loadUsers();
let activeUserIndex = 0;

function getActiveUser() {
    return loginUsers[activeUserIndex];
}

function rotateUser() {
    activeUserIndex = (activeUserIndex + 1) % loginUsers.length;
    return getActiveUser();
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

function assignmentContentRow(data) {
    return {
        id: data.id,
        pre_defined_data: toJson(data.pre_defined_data, null),
        answer: toJson(data.answer, null),
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

    await clickhouse.command({
        query: `
        CREATE TABLE IF NOT EXISTS ${ASSIGNMENT_CONTENT_TABLE_NAME}
        (
            id String,
            pre_defined_data Nullable(String),
            answer Nullable(String),
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

async function clearSession(page) {
    await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
    }).catch(() => {});

    const cookies = await page.cookies();
    if (cookies.length > 0) {
        await page.deleteCookie(...cookies);
    }

    await page.evaluateOnNewDocument(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
}

async function login(page, options = {}) {
    const { force = false } = options;
    const user = getActiveUser();

    if (force) {
        await clearSession(page);
    }

    console.log(`Login ke Fasih SM memakai akun ${user.username}`);
    await page.goto(LOGIN_URL, {
        waitUntil: "networkidle2",
        timeout: PAGE_TIMEOUT
    });

    const usernameInput = await page.$("#username");
    if (!usernameInput) {
        console.log("Sesi Fasih SM masih aktif");
        return;
    }

    await page.type("#username", user.username);
    await page.type("#password", user.password);

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

async function downloadAssignmentContent(page, task, xsrfToken) {
    return await page.evaluate(async ({ url, xsrfToken, taskId, timeout }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const res = await fetch(`${url}?id=${taskId}`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "accept": "application/json",
                    "content-type": "application/json",
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
    }, { url: ASSIGNMENT_CONTENT_URL, xsrfToken, taskId: task.id, timeout: FETCH_TIMEOUT });
}

async function downloadAssignmentContentWithRetry(page, task) {
    let lastError;
    const maxDownloadAttempt = Math.max(MAX_DOWNLOAD_RETRY, loginUsers.length);

    for (let attempt = 1; attempt <= maxDownloadAttempt; attempt++) {
        try {
            const xsrfToken = await getXsrfToken(page);
            if (!xsrfToken) {
                throw new Error("XSRF token tidak ditemukan");
            }

            const result = await downloadAssignmentContent(page, task, xsrfToken);
            if (!result || !result.data || !result.data._id || !result.data.pre_defined_data || !result.data.data) {
                throw new Error("Data hasil unduh tidak valid");
            }

            return result;
        } catch (error) {
            lastError = error;
            console.log(`Unduh isian ${task.id} gagal percobaan ${attempt}/${maxDownloadAttempt}: ${error.message}`);

            if (attempt < maxDownloadAttempt) {
                const nextUser = rotateUser();
                console.log(`Login ulang memakai akun ${nextUser.username} sebelum mengulang unduh isian`);
                await login(page, { force: true });
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

    let sql = fs.readFileSync(
        path.join(__dirname, 'assignment.sql'),
        'utf-8'
    );
    sql = sql.replace(/\bfrom\s+assignments\b/i, `from ${ASSIGNMENT_TABLE_NAME} FINAL`);

    if (!process.env.ISIAN_ALL) {
        const lastRows = await queryJsonEachRow(`
            SELECT dateModified
            FROM last_data FINAL
            ORDER BY dateModified DESC
            LIMIT 1
        `);

        if (lastRows.length > 0 && lastRows[0].dateModified) {
            sql = `${sql} and dateModified > '${lastRows[0].dateModified}'`
        }
    }

    let offset = 0;

    try {
        const index_main = fs.readFileSync(
            path.join(__dirname, 'index_asg.txt'),
            'utf-8'
        );

        offset = parseInt(index_main.trim(), 10);
        if (isNaN(offset)) offset = 0;

    } catch (e) {
        offset = 0;
    }

    sql = sql + ` ORDER BY id LIMIT 999999999 OFFSET ${offset}`;

    // 🔥 ambil tasks
    const tasks = await queryJsonEachRow(sql);

    const cliProgress = require('cli-progress');

    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    const total = tasks.length;
    bar.start(total, 0);


    for (const task of tasks) {
        const result = await downloadAssignmentContentWithRetry(page, task);
        let data = {}
        data['id'] = result.data._id
        data['pre_defined_data'] = JSON.parse(result.data.pre_defined_data)['predata']
        data['answer'] = JSON.parse(result.data.data)['answers']
        await insertJsonEachRow(ASSIGNMENT_CONTENT_TABLE_NAME, [assignmentContentRow(data)]);
        bar.increment();
        fs.writeFileSync('index_asg.txt', (offset + bar.value).toString());
    }
    bar.stop();
    console.log("Selesai download semua level");
    await optimizeTable(ASSIGNMENT_CONTENT_TABLE_NAME);
    // update last_data
    if (fs.existsSync('index_asg.txt')) {
        fs.unlinkSync('index_asg.txt');
    }
    await browser.close();
    await clickhouse.close();
}

crawl();
