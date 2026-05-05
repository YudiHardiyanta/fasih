const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Level5 = sequelize.define("Level5", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  name: DataTypes.STRING,

  fullCode: DataTypes.STRING,

  code: DataTypes.STRING

}, {
  tableName: "level_5",
  timestamps: false
});

module.exports = Level5;