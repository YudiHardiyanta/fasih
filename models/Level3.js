const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Level3 = sequelize.define("Level3", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  name: DataTypes.STRING,

  fullCode: DataTypes.STRING,

  code: DataTypes.STRING

}, {
  tableName: "level_3",
  timestamps: false
});

module.exports = Level3;