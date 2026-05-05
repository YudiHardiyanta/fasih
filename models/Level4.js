const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Level4 = sequelize.define("Level4", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  name: DataTypes.STRING,

  fullCode: DataTypes.STRING,

  code: DataTypes.STRING

}, {
  tableName: "level_4",
  timestamps: false
});

module.exports = Level4;