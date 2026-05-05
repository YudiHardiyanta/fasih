const { DataTypes } = require("sequelize");
const sequelize = require("../database");


const RegionGroup = sequelize.define("RegionGroup", {
    id: {
        type: DataTypes.UUID,
        primaryKey: true
    },

    levelCount: {
        type: DataTypes.INTEGER,
        allowNull: false
    },

    smallestRegionLevel: DataTypes.STRING,

    groupName: {
        type: DataTypes.STRING,
        allowNull: false
    },

    isActive: DataTypes.BOOLEAN,

    isPublic: {
        type: DataTypes.BOOLEAN,
        allowNull: true
    },

    createdBy: DataTypes.UUID,

    updatedBy: {
        type: DataTypes.UUID,
        allowNull: true
    },

    createdDate: DataTypes.DATE,
    updatedDate: DataTypes.DATE,

    // 🔥 array userIds
    userIds: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
    },

    // 🔥 nested level (array of object)
    level: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
    },

    // 🧠 simpan raw API
    raw: {
        type: DataTypes.JSON,
        allowNull: true
    }

}, {
    tableName: "region_groups_ngibar",
});

module.exports = RegionGroup;