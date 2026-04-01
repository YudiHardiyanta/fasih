const puppeteer = require("puppeteer");
const survey_id = "2395b67d-d1af-4739-9ef8-c0cc0aa9ce9a";
const Level2 = require("./models/Level2");
const Level3 = require("./models/Level3");
const Level4 = require("./models/Level4");
const ppl = require("./models/ppl");
const Assignment = require("./models/assignment");
const sequelize = require("./database");
require('dotenv').config();



async function crawl(survey_id) {
    await sequelize.authenticate();
    console.log("Database connected");

    // 2 otomatis buat tabel
    await sequelize.sync();

    const browser = await puppeteer.launch({
        headless: false
    });

    const page = await browser.newPage();

    await page.goto("https://fasih-sm.bps.go.id/oauth2/authorization/ics", {
        waitUntil: "networkidle2"
    });

    await page.type("#username", process.env.USERNAME_COMMUNITY);
    await page.type("#password", process.env.PASSWORD_COMMUNITY);
    await page.click("#kc-login");
    await page.waitForNavigation();

    await page.goto("https://fasih-sm.bps.go.id/survey-collection/collect/" + survey_id, {
        waitUntil: "networkidle2"
    });
    const params = {
        region1Id: "92f3f2ce-8e70-44b0-bc02-b172e9671000",
        region2Id: "",
        region3Id: "",
        fullcode3: "",
        currentUserId: "",
    }
    //filter level 2
    console.log('download level 2')
    const data2 = await page.evaluate(async (params) => {
        const res = await fetch(
            "https://fasih-sm.bps.go.id/region/api/v1/region/level2?groupId=7381fdcf-255d-47a7-b791-cebe05689e60&level1FullCode=51",
            {
                method: "GET",
                credentials: "include",
                headers: {
                    "accept": "application/json"
                }
            }
        );
        return await res.json();
    }, params);

    for (const item of data2.data) {
        await Level2.upsert({
            id: item.id,
            fullCode: item.fullCode,
            code: item.code,
            name: item.name,
        });
        //download level 3
        params['region2Id'] = item.id
        console.log('download level 3')
        const data3 = await page.evaluate(async (params) => {
            const res = await fetch(
                `https://fasih-sm.bps.go.id/region/api/v1/region/level3?groupId=7381fdcf-255d-47a7-b791-cebe05689e60&level2Id=${params['region2Id']}`,
                {
                    method: "GET",
                    credentials: "include",
                    headers: {
                        "accept": "application/json"
                    }
                }
            );
            return await res.json();
        }, params);

        for (const item3 of data3.data) {
            await Level3.upsert({
                id: item3.id,
                fullCode: item3.fullCode,
                code: item3.code,
                name: item3.name,
            });
            params['region3Id'] = item3.id
            params['fullcode3'] = item3.fullCode
            console.log('download level 4')
            const data4 = await page.evaluate(async (params) => {
                const res = await fetch(
                    `https://fasih-sm.bps.go.id/region/api/v1/region/level4?groupId=7381fdcf-255d-47a7-b791-cebe05689e60&level3Id=${params['region3Id']}`,
                    {
                        method: "GET",
                        credentials: "include",
                        headers: {
                            "accept": "application/json"
                        }
                    }
                );
                return await res.json();
            }, params);

            for (const item4 of data4.data) {
                await Level4.upsert({
                    id: item4.id,
                    fullCode: item4.fullCode,
                    code: item4.code,
                    name: item4.name,
                });
                params['region4Id'] = item4.id
                params['fullcode4'] = item4.fullCode
                console.log('download level 5')
                

                //download assignment
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
                        region1Id: params['region1Id'],
                        region2Id: params['region2Id'],
                        region3Id: params['region3Id'],
                        region4Id: params['region4Id'],
                        region5Id: null,
                        region6Id: null,
                        region7Id: null,
                        region8Id: null,
                        region9Id: null,
                        region10Id: null,

                        surveyPeriodId: "39136966-8f3c-4a0c-915b-0f65eb223475",

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
                const cookies = await page.cookies();

                const xsrfCookie = cookies.find(c => c.name === "XSRF-TOKEN");

                const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : null;
                const data5 = await page.evaluate(async (xsrfToken, body) => {
                    const res = await fetch(
                        "https://fasih-sm.bps.go.id/analytic/api/v2/assignment/datatable-all-user-survey-periode",
                        {
                            method: "POST",
                            credentials: "include",
                            headers: {
                                "accept": "application/json",
                                "content-type": "application/json",
                                "x-xsrf-token": xsrfToken
                            },
                            body: JSON.stringify(body)
                        }
                    );

                    return await res.json();
                }, xsrfToken, body);

                await Assignment.bulkCreate(data5.searchData, {
                    updateOnDuplicate: [
                        surveyPeriodId,
                        mode,
                        assignmentErrorStatusType,
                        userIdResponsibility,
                        approvedByCreator,  
                        codeIdentity,
                        assignmentStatusId,
                        assignmentStatusAlias,
                        data1,
                        data2,
                        data3,
                        data4,
                        data5,
                        data6,
                        data7,
                        data8,
                        data9,
                        data10,
                        dateCreated,
                        dateModified,
                        isActive,
                        done,
                        secondary,
                        longitude,
                        latitude,
                        copyFromId,
                        externalDone,
                        currentUserId,
                        currentUserUsername,
                        currentUserFullname,
                        currentUserSurveyRoleId,
                        currentUserSurveyRoleName,
                        currentUserSurveyRoleIsPencacah,
                        currentUserSurveyRoleCanPullSample,
                        sourceFrom,
                        listing,
                        assignmentResponsibility,
                        assignmentResponsibilityAdmin,
                        region,
                        regionMetadata,
                        sampleType,
                        isTarget,
                        referencedTo,
                        lockedByUser,
                        lockedByAnother,
                    ]
                });

            }







        }


    }




    await browser.close();
}

crawl();