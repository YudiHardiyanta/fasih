const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Level2 = sequelize.define("Level2", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  name: DataTypes.STRING,

  fullCode: DataTypes.STRING,

  code: DataTypes.STRING

}, {
  tableName: "level_2",
  timestamps: false
});

module.exports = Level2;