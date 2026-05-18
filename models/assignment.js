const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Assignment = sequelize.define("Assignment", {

    id: {
        type: DataTypes.UUID,
        primaryKey: true
    },

    surveyPeriodId: {
        type: DataTypes.UUID
    },

    mode: {
        type: DataTypes.JSON
    },

    assignmentErrorStatusType: {
        type: DataTypes.INTEGER
    },

    userIdResponsibility: {
        type: DataTypes.UUID
    },

    approvedByCreator: {
        type: DataTypes.BOOLEAN
    },

    codeIdentity: {
        type: DataTypes.TEXT
    },

    assignmentStatusId: {
        type: DataTypes.INTEGER
    },

    assignmentStatusAlias: {
        type: DataTypes.STRING
    },

    data1: {
        type: DataTypes.STRING(500)
    },

    data2: {
        type: DataTypes.STRING(500)
    },

    data3: {
        type: DataTypes.STRING(500)
    },

    data4: {
        type: DataTypes.STRING(500)
    },

    data5: {
        type: DataTypes.STRING(500)
    },

    data6: {
        type: DataTypes.STRING(500)
    },

    data7: {
        type: DataTypes.STRING(500)
    },

    data8: {
        type: DataTypes.STRING(500)
    },

    data9: {
        type: DataTypes.STRING(500)
    },

    data10: {
        type: DataTypes.STRING(500)
    },

    dateCreated: {
        type: DataTypes.DATE
    },

    dateModified: {
        type: DataTypes.DATE
    },

    isActive: {
        type: DataTypes.BOOLEAN
    },

    done: {
        type: DataTypes.BOOLEAN
    },

    secondary: {
        type: DataTypes.BOOLEAN
    },

    longitude: {
        type: DataTypes.DOUBLE
    },

    latitude: {
        type: DataTypes.DOUBLE
    },

    copyFromId: {
        type: DataTypes.UUID
    },

    externalDone: {
        type: DataTypes.BOOLEAN
    },

    currentUserId: {
        type: DataTypes.UUID
    },

    currentUserUsername: {
        type: DataTypes.STRING
    },

    currentUserFullname: {
        type: DataTypes.STRING
    },

    currentUserSurveyRoleId: {
        type: DataTypes.UUID
    },

    currentUserSurveyRoleName: {
        type: DataTypes.STRING
    },

    currentUserSurveyRoleIsPencacah: {
        type: DataTypes.BOOLEAN
    },

    currentUserSurveyRoleCanPullSample: {
        type: DataTypes.BOOLEAN
    },

    sourceFrom: {
        type: DataTypes.STRING
    },

    listing: {
        type: DataTypes.BOOLEAN
    },

    assignmentResponsibility: {
        type: DataTypes.JSON
    },

    assignmentResponsibilityAdmin: {
        type: DataTypes.JSON
    },

    region: {
        type: DataTypes.JSON
    },

    regionMetadata: {
        type: DataTypes.JSON
    },

    sampleType: {
        type: DataTypes.INTEGER
    },

    isTarget: {
        type: DataTypes.BOOLEAN
    },

    referencedTo: {
        type: DataTypes.JSON
    },

    lockedByUser: {
        type: DataTypes.BOOLEAN
    },

    lockedByAnother: {
        type: DataTypes.BOOLEAN
    }

}, {
    tableName: "assignments",
    timestamps: false
});

module.exports = Assignment;