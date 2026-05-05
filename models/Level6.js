const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Level6 = sequelize.define("Level6", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  name: DataTypes.STRING,

  fullCode: DataTypes.STRING,

  code: DataTypes.STRING

}, {
  tableName: "level_6_ngibar",
  timestamps: false
});

module.exports = Level6;