const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Unduh = sequelize.define("unduh", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  start: {
    type: DataTypes.DATE
  },

  finish: {
    type: DataTypes.DATE
  },

}, {
  tableName: "unduh",
  timestamps: false
});

module.exports = Unduh;