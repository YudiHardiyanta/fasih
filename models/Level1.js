const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Level1 = sequelize.define("Level1", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  name: DataTypes.STRING,

  fullCode: DataTypes.STRING,

  code: DataTypes.STRING

}, {
  tableName: "level_1_ngibar",
  timestamps: false
});

module.exports = Level1;